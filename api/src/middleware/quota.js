const Client = require('../models/Client');

/**
 * Middleware de quota mensuel.
 * Doit être utilisé APRÈS auth (nécessite req.client).
 *
 * Réinitialise automatiquement le compteur si quotaResetAt est dépassé.
 * Bloque avec 429 si quotaUsed >= quotaLimit.
 * Ajoute les headers X-Quota-* dans chaque réponse.
 *
 * N'incrémente PAS ici — c'est la route qui incrémente après succès,
 * pour ne pas consommer du quota sur des emails invalides (400).
 */
async function quota(req, res, next) {
  const client = req.client;
  const now    = new Date();

  // Valeurs par défaut pour les comptes sans champs quota (créés avant la migration)
  if (client.quotaUsed    == null) client.quotaUsed    = 0;
  if (client.quotaLimit   == null) client.quotaLimit   = 100;
  if (!client.quotaResetAt) {
    const nextReset = new Date(now);
    nextReset.setMonth(nextReset.getMonth() + 1, 1);
    nextReset.setHours(0, 0, 0, 0);
    client.quotaResetAt = nextReset;
  }

  // Réinitialisation mensuelle automatique
  if (now >= new Date(client.quotaResetAt)) {
    const nextReset = new Date(now);
    nextReset.setMonth(nextReset.getMonth() + 1, 1);
    nextReset.setHours(0, 0, 0, 0);

    await Client.findByIdAndUpdate(client._id, { quotaUsed: 0, quotaResetAt: nextReset });
    client.quotaUsed    = 0;
    client.quotaResetAt = nextReset;
  }

  const remaining = Math.max(0, client.quotaLimit - client.quotaUsed);

  res.setHeader('X-Quota-Limit',     client.quotaLimit);
  res.setHeader('X-Quota-Remaining', remaining);
  res.setHeader('X-Quota-Reset',     new Date(client.quotaResetAt).toISOString());

  if (client.quotaUsed >= client.quotaLimit) {
    return res.status(429).json({
      error:      'Quota mensuel épuisé',
      quotaUsed:  client.quotaUsed,
      quotaLimit: client.quotaLimit,
      resetAt:    client.quotaResetAt,
      message:    'Passez au plan Pro pour des vérifications illimitées',
    });
  }

  next();
}

module.exports = quota;
