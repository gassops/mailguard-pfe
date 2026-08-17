const express  = require('express');
const router   = express.Router();

const auth      = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const Report    = require('../models/Report');

// POST /api/v1/report
router.post('/report', auth, rateLimit, async (req, res) => {
  const { email, type } = req.body;

  if (!email || !type) {
    return res.status(400).json({ error: 'Champs "email" et "type" requis' });
  }

  if (!['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(type)) {
    return res.status(400).json({ error: 'Type doit être FALSE_POSITIVE ou FALSE_NEGATIVE' });
  }

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  try {
    // Vérifier si ce client a déjà signalé cet email
    const existing = await Report.findOne({ clientId: req.client._id, email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Vous avez déjà signalé cet email' });
    }

    await Report.create({
      clientId: req.client._id,
      email:    email.toLowerCase(),
      domain,
      type,
    });

    res.status(201).json({ message: 'Signalement enregistré', email, type });

  } catch (err) {
    console.error('[/report]', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
