const crypto = require('crypto');
const axios  = require('axios');

const Webhook = require('../models/Webhook');
const { getRedis } = require('../utils/redis');

const DISPATCH_TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10);
// La grande majorité des clients n'a aucun webhook configuré : sans cache, chaque
// /verify paie malgré tout une requête MongoDB pour le constater. On met donc en
// cache le résultat *y compris négatif* (chaîne vide = pas de webhook). TTL court
// pour qu'un webhook nouvellement enregistré soit pris en compte rapidement.
const LOOKUP_CACHE_TTL = parseInt(process.env.WEBHOOK_LOOKUP_TTL_SECONDS || '60', 10);

async function findWebhookCached(clientId) {
  const key = `webhook:${clientId}`;

  // getRedis() lève si Redis n'est pas initialisé : à l'intérieur du try, pour
  // que l'indisponibilité de Redis fasse simplement retomber sur MongoDB.
  try {
    const cached = await getRedis().get(key);
    if (cached !== null) return cached === '' ? null : JSON.parse(cached);
  } catch (err) {
    // Redis indisponible : on interroge MongoDB directement
  }

  const webhook = await Webhook.findOne({ clientId, active: true }).lean();

  try {
    await getRedis().setex(key, LOOKUP_CACHE_TTL, webhook ? JSON.stringify(webhook) : '');
  } catch (err) {
    // best-effort
  }

  return webhook;
}

/**
 * Signe le payload avec HMAC-SHA256 (secret propre à chaque webhook), pour que
 * le client destinataire puisse vérifier que la notification vient bien de
 * MailGuard et n'a pas été altérée en transit.
 *
 * @param {string} secret
 * @param {object} payload
 * @returns {string} - signature hex, envoyée dans le header X-MailGuard-Signature
 */
function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * Déclenche la notification webhook du client si un webhook actif est
 * configuré et que le verdict de cette vérification fait partie des
 * événements souscrits. Volontairement fire-and-forget : ne doit jamais
 * ralentir ni faire échouer la réponse de /verify (voir appel dans
 * verify.js — jamais awaité sur le chemin critique).
 *
 * Portée assumée : un seul essai, timeout court, pas de file de retry —
 * un webhook n'est qu'une notification best-effort, pas une garantie de
 * livraison (voir chapitre 6, discussion).
 *
 * @param {string} clientId
 * @param {string} verdict - 'VALID' | 'SUSPICIOUS' | 'INVALID'
 * @param {object} verificationResult - la réponse complète de /verify
 */
async function dispatch(clientId, verdict, verificationResult) {
  try {
    const webhook = await findWebhookCached(clientId);
    if (!webhook || !webhook.events.includes(verdict)) return;

    const payload = {
      event:     verdict,
      email:     verificationResult.email,
      domain:    verificationResult.domain,
      score:     verificationResult.score,
      verdict:   verificationResult.verdict,
      timestamp: new Date().toISOString(),
    };

    const headers = { 'Content-Type': 'application/json' };
    if (webhook.secret) {
      headers['X-MailGuard-Signature'] = `sha256=${sign(webhook.secret, payload)}`;
    }

    await axios.post(webhook.url, payload, { timeout: DISPATCH_TIMEOUT_MS, headers });

    await Webhook.findByIdAndUpdate(webhook._id, { lastTriggered: new Date() });

  } catch (err) {
    // Best-effort : un webhook qui échoue (URL injoignable, timeout, 4xx/5xx
    // côté client) ne doit jamais impacter /verify — on se contente de logger.
    console.error('[webhookDispatcher]', err.message);
  }
}

module.exports = { dispatch, sign };
