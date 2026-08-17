const express  = require('express');
const router   = express.Router();

const auth      = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const Webhook   = require('../models/Webhook');

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
    // Un seul webhook actif par client — upsert
    const webhook = await Webhook.findOneAndUpdate(
      { clientId: req.client._id },
      { url, events: eventsArr, active: true },
      { upsert: true, new: true }
    );

    res.status(201).json({
      message: 'Webhook configuré',
      webhook: { url: webhook.url, events: webhook.events },
    });

  } catch (err) {
    console.error('[/webhook]', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
