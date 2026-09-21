const express  = require('express');
const crypto   = require('crypto');
const router   = express.Router();

const auth      = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const Webhook   = require('../models/Webhook');
const { getRedis } = require('../utils/redis');

// POST /api/v1/webhook
router.post('/webhook', auth, rateLimit, async (req, res) => {
  const { url, events } = req.body;

  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ error: 'URL HTTPS requise' });
  }

  const allowedEvents = ['INVALID', 'SUSPICIOUS', 'VALID'];
  const eventsArr = Array.isArray(events) && events.length > 0 ? events : ['INVALID'];
  const invalid = eventsArr.filter(e => !allowedEvents.includes(e));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Événements invalides : ${invalid.join(', ')}` });
  }

  try {
    // Un seul webhook actif par client — upsert. Le secret HMAC est généré
    // une seule fois (conservé lors des mises à jour) et sans endpoint GET
    // dédié, la seule façon de le récupérer est cette réponse — limite de
    // portée assumée (voir chapitre 6, discussion) plutôt qu'un vrai flux
    // de rotation de secret.
    const existing = await Webhook.findOne({ clientId: req.client._id });
    const secret = existing?.secret || crypto.randomBytes(32).toString('hex');

    const webhook = await Webhook.findOneAndUpdate(
      { clientId: req.client._id },
      { url, events: eventsArr, active: true, secret },
      { upsert: true, new: true }
    );

    // Invalide le cache de lookup du dispatcher, sinon le nouveau webhook
    // ne serait pris en compte qu'à l'expiration du TTL.
    try { await getRedis().del(`webhook:${req.client._id}`); } catch (err) { /* best-effort */ }

    res.status(201).json({
      message: 'Webhook configuré',
      webhook: { url: webhook.url, events: webhook.events, secret: webhook.secret },
    });

  } catch (err) {
    console.error('[/webhook]', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
