const express      = require('express');
const router       = express.Router();

const auth         = require('../middleware/auth');
const rateLimit    = require('../middleware/rateLimit');
const quota        = require('../middleware/quota');
const freeQuota    = require('../middleware/freeQuota');
const persistence  = require('../utils/persistence');
const { getRedis } = require('../utils/redis');
const metrics      = require('../utils/metrics');
const { aggregate } = require('../services/scoreAggregator');
const webhookDispatcher = require('../services/webhookDispatcher');

const blacklist   = require('../modules/blacklist');
const mx          = require('../modules/mx');
const smtp        = require('../modules/smtp');
const domainAge   = require('../modules/domainAge');
const ml          = require('../modules/ml');
const crowdsource = require('../modules/crowdsource');

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10);
// domainAge (WHOIS) ne dépend que du domaine, pas de l'adresse email complète —
// contrairement au cache verify:* (par email), on peut donc réutiliser le
// résultat entre toutes les adresses d'un même domaine. TTL long (24h) car la
// date de création d'un domaine ne change pas.
const WHOIS_CACHE_TTL = parseInt(process.env.WHOIS_CACHE_TTL_SECONDS || '86400', 10);
// Le classifieur ML ne reçoit que le domaine (voir ml.js : POST /predict {domain}),
// pas l'email complet — même logique de cache que WHOIS. TTL plus court (1h,
// aligné sur CACHE_TTL) car un domaine pourrait en théorie changer de
// caractéristiques structurelles suivies par le modèle plus vite qu'un WHOIS.
const ML_CACHE_TTL = parseInt(process.env.ML_CACHE_TTL_SECONDS || '3600', 10);
// mx.analyze() ne dépend que du domaine et fait une vraie résolution DNS
// (dns.resolveMx) à chaque appel — même profil que WHOIS/ML. Les enregistrements
// MX changent rarement : TTL aligné sur WHOIS.
const MX_CACHE_TTL = parseInt(process.env.MX_CACHE_TTL_SECONDS || '86400', 10);
// crowdsource.analyze() fait jusqu'à 3 requêtes MongoDB (Domain.findOne + deux
// countDocuments) et ne dépend, lui aussi, que du domaine. TTL volontairement
// court : un signalement validé par la communauté doit se propager rapidement.
const CROWD_CACHE_TTL = parseInt(process.env.CROWD_CACHE_TTL_SECONDS || '60', 10);

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────────────────────────

function extractDomain(email) {
  return email.split('@')[1]?.toLowerCase() || null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Lance les 6 modules d'analyse et retourne leurs résultats.
 * Stratégie en 2 phases pour que smtp puisse utiliser le serveur MX réel :
 *   Phase 1 (parallèle) : blacklist, mx, domainAge, ml, crowdsource
 *   Phase 2             : smtp (utilise mx.mx du résultat phase 1)
 */
// Cache générique par domaine — utilisé par mx, domainAge et ml, qui ne
// dépendent que du domaine (pas de l'email complet) et font chacun un appel
// réseau/externe coûteux (DNS, WHOIS, microservice ML).
async function analyzeCachedByDomain(prefix, ttl, domain, fn) {
  const key = `${prefix}:${domain}`;

  try {
    const cached = await getRedis().get(key);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    // Redis indisponible : on continue sans cache plutôt que de faire échouer l'analyse
  }

  const result = await fn();

  try {
    await getRedis().setex(key, ttl, JSON.stringify(result));
  } catch (err) {
    // idem : l'échec de la mise en cache ne doit pas faire échouer la réponse
  }

  return result;
}

// Le SMTP est un échange réseau réel avec le serveur du destinataire (4 allers-retours,
// non cachable par domaine, parfois volontairement ralenti par les grands fournisseurs) :
// il ne doit pas bloquer la réponse. On répond sans lui (statut PENDING, score neutre 0),
// puis le verdict est affiné en arrière-plan (refineOnSmtp) et le résultat SMTP est mis
// en cache par adresse pour les appels suivants.
// Le cache est une optimisation, jamais une condition de réussite : un Redis lent ou indisponible
// est journalisé et ignoré, la requête continue sans cache.
function logCacheError(err) {
  console.error('[cache] Redis indisponible :', err.message);
  return null;
}

const SMTP_CACHE_TTL    = parseInt(process.env.SMTP_CACHE_TTL_SECONDS || '3600', 10);
const PENDING_CACHE_TTL = 60;
const SMTP_PENDING = { exists: null, score: 0, status: 'PENDING', reasons: [] };

// La clé du cache SMTP ne dépend que de l'adresse : on la lit EN PARALLÈLE de la première phase
// d'analyse au lieu d'attendre la fin de celle-ci (un aller-retour Redis de moins sur le chemin critique).
async function lookupSmtpCache(email) {
  try {
    const cached = await getRedis().get(`smtp:${email}`);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    return null; // Redis indisponible : on continue sans cache
  }
}

// Disjoncteur : quand une sonde SMTP échoue au niveau du serveur (délai dépassé, connexion refusée,
// session rejetée : statut UNKNOWN), les sondes suivantes vers ce domaine échoueraient de la même
// façon — typiquement le port 25 est bloqué sur le réseau. On cesse de sonder ce domaine pendant
// SMTP_DOWN_TTL au lieu d'ouvrir une connexion, avec sa résolution DNS et ses minuteurs, à CHAQUE
// vérification. Un résultat définitif (EXISTS / NOT_EXISTS) ne déclenche jamais le disjoncteur.
const SMTP_DOWN_TTL = parseInt(process.env.SMTP_DOWN_TTL_SECONDS || '300', 10);
const SMTP_SKIPPED  = { exists: null, score: 0, status: 'UNKNOWN', reasons: [] };

async function lookupSmtpDown(domain) {
  try { return (await getRedis().get(`smtp:down:${domain}`)) !== null; } catch (err) { return false; }
}

async function resolveSmtp(email, domain, mxHost, cached, down) {
  if (!mxHost) return { result: await smtp.analyze(email, mxHost), done: null };
  if (cached) return { result: cached, done: null };
  if (down)   return { result: SMTP_SKIPPED, done: null };

  const redis = getRedis();
  const key = `smtp:${email}`;

  const done = smtp.analyze(email, mxHost)
    .then(async (result) => {
      try {
        await redis.setex(key, SMTP_CACHE_TTL, JSON.stringify(result));
        if (result.status === 'UNKNOWN') await redis.setex(`smtp:down:${domain}`, SMTP_DOWN_TTL, '1');
      } catch (err) { /* best-effort */ }
      return result;
    })
    .catch(() => null);

  return { result: SMTP_PENDING, done };
}

async function runAnalysis(email, domain) {
  const [blacklistResult, mxResult, domainAgeResult, mlResult, crowdsourceResult, smtpCached, smtpDown] =
    await Promise.all([
      blacklist.analyze(email, domain),
      analyzeCachedByDomain('mx', MX_CACHE_TTL, domain, () => mx.analyze(domain)),
      analyzeCachedByDomain('whois', WHOIS_CACHE_TTL, domain, () => domainAge.analyze(domain)),
      analyzeCachedByDomain('ml', ML_CACHE_TTL, domain, () => ml.analyze(email, domain)),
      analyzeCachedByDomain('crowd', CROWD_CACHE_TTL, domain, () => crowdsource.analyze(email, domain)),
      lookupSmtpCache(email),
      lookupSmtpDown(domain),
    ]);

  const { result: smtpResult, done: smtpDone } = await resolveSmtp(email, domain, mxResult.mx, smtpCached, smtpDown);

  return {
    moduleResults: { blacklist: blacklistResult, mx: mxResult, smtp: smtpResult,
                     domainAge: domainAgeResult, ml: mlResult, crowdsource: crowdsourceResult },
    smtpDone,
  };
}

function cacheTtlFor(details) {
  return details?.smtp_check?.status === 'PENDING' ? PENDING_CACHE_TTL : CACHE_TTL;
}

// Une fois le SMTP terminé : recalcule score/verdict, met à jour le cache (TTL complet),
// la vérification persistée et, si le verdict a changé, redéclenche le webhook.
function refineOnSmtp(smtpDone, ctx) {
  if (!smtpDone) return;
  smtpDone.then(async (smtpResult) => {
    if (!smtpResult) return;
    const { moduleResults, thresholds, response, cacheKey, verificationId, clientId } = ctx;

    const refined = aggregate({ ...moduleResults, smtp: smtpResult }, thresholds);
    const finalResponse = {
      ...response,
      verdict: refined.verdict, score: refined.score,
      details: refined.details, reasons: refined.reasons,
    };

    await getRedis().setex(cacheKey, CACHE_TTL, JSON.stringify(finalResponse));
    if (verificationId) {
      await persistence.updateVerification(verificationId,
        { score: refined.score, verdict: refined.verdict, details: refined.details });
    }
    if (clientId && refined.verdict !== response.verdict) {
      webhookDispatcher.dispatch(clientId, refined.verdict, finalResponse);
    }
  }).catch((err) => console.error('[smtp-refine]', err.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify', auth, rateLimit, quota, async (req, res) => {
  const start = Date.now();
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Champ "email" invalide ou manquant' });
  }

  const emailNorm = email.toLowerCase().trim();
  const domain    = extractDomain(emailNorm);

  if (!domain) {
    return res.status(400).json({ error: 'Domaine introuvable dans l\'email' });
  }

  const redis    = getRedis();
  const cacheKey = `verify:${emailNorm}`;

  try {
    // ── Cache Redis ────────────────────────────────────────────────────────────
    const cached = await redis.get(cacheKey).catch(logCacheError); // échec du cache = simple défaut de cache
    if (cached) {
      metrics.cacheHitsTotal.inc();
      const cachedResponse = { ...JSON.parse(cached), cached: true };
      // Fire-and-forget — ne jamais attendre le webhook sur le chemin critique
      webhookDispatcher.dispatch(req.client._id, cachedResponse.verdict, cachedResponse);
      return res.json(cachedResponse);
    }
    metrics.cacheMissesTotal.inc();

    // ── Analyse ────────────────────────────────────────────────────────────────
    const { moduleResults, smtpDone } = await runAnalysis(emailNorm, domain);
    const { score, verdict, reasons, details } = aggregate(
      moduleResults,
      req.client.thresholds
    );

    const processingTimeMs = Date.now() - start;

    const response = {
      email:   emailNorm,
      domain,
      verdict,
      score,
      details,
      reasons,
      cached:          false,
      processingTimeMs,
    };

    // ── Persistance MongoDB ────────────────────────────────────────────────────
    // Les deux écritures sont indépendantes : lancées en parallèle (un aller-retour de moins), et
    // via le pilote natif (voir utils/persistence.js). La réponse n'est toujours envoyée qu'une
    // fois les données écrites : rien n'est perdu si le pod s'arrête juste après.
    const [verification] = await Promise.all([
      persistence.insertVerification({
        clientId: req.client._id, email: emailNorm, domain, score, verdict, details, processingTimeMs,
      }),
      // ── Consommation du quota mensuel ────────────────────────────────────────
      persistence.incrementQuota(req.client._id),
      // ── Invalidation du cache stats (pour refresh immédiat côté dashboard) ────
      redis.del(`stats:${req.client._id}:30`).catch(logCacheError),
      // ── Mise en cache ────────────────────────────────────────────────────────
      redis.setex(cacheKey, cacheTtlFor(details), JSON.stringify(response)).catch(logCacheError),
    ]);
    const newRemaining = Math.max(0, (req.client.quotaLimit ?? 100) - ((req.client.quotaUsed ?? 0) + 1));
    res.setHeader('X-Quota-Remaining', newRemaining);

    refineOnSmtp(smtpDone, {
      moduleResults, thresholds: req.client.thresholds, response, cacheKey,
      verificationId: verification._id, clientId: req.client._id,
    });

    // ── Métriques ──────────────────────────────────────────────────────────────
    metrics.verdictsTotal.inc({ verdict });

    // Fire-and-forget — ne jamais attendre le webhook sur le chemin critique
    webhookDispatcher.dispatch(req.client._id, verdict, response);

    return res.json(response);

  } catch (err) {
    console.error('[/verify]', err.message);
    res.status(500).json({ error: 'Erreur interne lors de la vérification' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify/free — vérification anonyme, sans compte (3 / 24h par IP)
// Même pipeline d'analyse que /verify, mais pas de clé API, pas de quota
// mensuel Client, pas de persistance en base (essais anonymes non liés à
// un client). Protégé par freeQuota (compteur Redis par IP).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify/free', freeQuota, async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Champ "email" invalide ou manquant' });
  }

  const emailNorm = email.toLowerCase().trim();
  const domain    = extractDomain(emailNorm);

  if (!domain) {
    return res.status(400).json({ error: 'Domaine introuvable dans l\'email' });
  }

  const redis    = getRedis();
  const cacheKey = `verify:${emailNorm}`;

  try {
    const cached = await redis.get(cacheKey).catch(logCacheError);
    if (cached) {
      metrics.cacheHitsTotal.inc();
      return res.json({ ...JSON.parse(cached), cached: true });
    }
    metrics.cacheMissesTotal.inc();

    const { moduleResults, smtpDone } = await runAnalysis(emailNorm, domain);
    const { score, verdict, reasons, details } = aggregate(moduleResults);

    const response = {
      email:   emailNorm,
      domain,
      verdict,
      score,
      details,
      reasons,
      cached: false,
    };

    await redis.setex(cacheKey, cacheTtlFor(details), JSON.stringify(response)).catch(logCacheError);
    refineOnSmtp(smtpDone, { moduleResults, response, cacheKey });
    metrics.verdictsTotal.inc({ verdict });

    return res.json(response);

  } catch (err) {
    console.error('[/verify/free]', err.message);
    res.status(500).json({ error: 'Erreur interne lors de la vérification' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify/bulk
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify/bulk', auth, rateLimit, async (req, res) => {
  const { emails } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'Champ "emails" doit être un tableau non vide' });
  }

  if (emails.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 emails par requête bulk' });
  }

  // Appel séquentiel contrôlé pour éviter de saturer DNS / SMTP
  const results = [];
  for (const email of emails) {
    if (!isValidEmail(email)) {
      results.push({ email, error: 'Format invalide' });
      continue;
    }

    const emailNorm = email.toLowerCase().trim();
    const domain    = extractDomain(emailNorm);
    const redis     = getRedis();
    const cacheKey  = `verify:${emailNorm}`;

    try {
      const cached = await redis.get(cacheKey).catch(logCacheError);
      if (cached) {
        metrics.cacheHitsTotal.inc();
        results.push({ ...JSON.parse(cached), cached: true });
        continue;
      }

      metrics.cacheMissesTotal.inc();
      const { moduleResults, smtpDone } = await runAnalysis(emailNorm, domain);
      const { score, verdict, reasons, details } = aggregate(
        moduleResults,
        req.client.thresholds
      );

      const response = { email: emailNorm, domain, verdict, score, details, reasons, cached: false };

      await redis.setex(cacheKey, cacheTtlFor(details), JSON.stringify(response)).catch(logCacheError);
      refineOnSmtp(smtpDone, {
        moduleResults, thresholds: req.client.thresholds, response, cacheKey,
        clientId: req.client._id,
      });
      metrics.verdictsTotal.inc({ verdict });
      results.push(response);

    } catch (err) {
      results.push({ email: emailNorm, error: 'Erreur lors de la vérification' });
    }
  }

  res.json({ total: results.length, results });
});

module.exports = router;
