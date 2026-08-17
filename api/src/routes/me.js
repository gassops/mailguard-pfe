const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');

/**
 * GET /api/v1/me
 * Retourne le profil du client connecté + état du quota mensuel.
 */
router.get('/me', auth, async (req, res) => {
  const c   = req.client;
  const now = new Date();

  // Valeurs par défaut pour les comptes créés avant l'ajout du quota
  const quotaLimit = c.quotaLimit ?? 100;
  let   quotaUsed  = c.quotaUsed  ?? 0;

  // Calculer la date de reset si absente (1er du mois prochain)
  let quotaResetAt = c.quotaResetAt;
  if (!quotaResetAt) {
    quotaResetAt = new Date(now);
    quotaResetAt.setMonth(quotaResetAt.getMonth() + 1, 1);
    quotaResetAt.setHours(0, 0, 0, 0);
  }

  // Reset automatique si la date est dépassée
  if (now >= new Date(quotaResetAt)) {
    quotaUsed = 0;
  }

  res.json({
    name:            c.name,
    email:           c.email,
    plan:            'free',
    quotaUsed,
    quotaLimit,
    quotaResetAt,
    rateLimitPerMin: c.rateLimitPerMin ?? 100,
  });
});

module.exports = router;
