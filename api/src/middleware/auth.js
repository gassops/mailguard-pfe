const Client = require('../models/Client');

/**
 * Middleware d'authentification par clé API.
 *
 * Vérifie le header X-API-Key à chaque requête :
 *   1. Header présent ?
 *   2. Clé existante dans MongoDB (index sur apiKey) ?
 *   3. Compte actif ?
 *
 * Si OK → attache le client à req.client et passe au suivant.
 * Si KO → 401 Unauthorized.
 */
async function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Clé API manquante (header X-API-Key requis)' });
  }

  try {
    const client = await Client.findOne({ apiKey, active: true }).lean();

    if (!client) {
      return res.status(401).json({ error: 'Clé API invalide ou compte désactivé' });
    }

    // Disponible dans tous les handlers suivants
    req.client = client;
    next();

  } catch (err) {
    console.error('[auth] Erreur MongoDB :', err.message);
    res.status(500).json({ error: 'Erreur interne lors de l\'authentification' });
  }
}

module.exports = auth;
