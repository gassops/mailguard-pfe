const { getRedis } = require('../utils/redis');

const FREE_LIMIT     = 3;
const WINDOW_SECONDS = 24 * 60 * 60; // 24h glissantes par IP

/**
 * Middleware de quota gratuit — vérification anonyme sans clé API.
 *
 * Compte les requêtes par IP dans Redis (clé : freequota:<ip>).
 * Contrairement à rateLimit.js (fail-open, protège des clients déjà
 * authentifiés), ce middleware fail-close : sans Redis pour compter les
 * essais, impossible de garantir la limite, donc on refuse plutôt que
 * d'ouvrir un accès illimité et non authentifié au pipeline d'analyse.
 *
 * nginx (frontend) transmet l'IP réelle via X-Real-IP (voir nginx.conf).
 */
function getClientIp(req) {
  return req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';
}

async function freeQuota(req, res, next) {
  const redis = getRedis();
  const ip    = getClientIp(req);
  const key   = `freequota:${ip}`;

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }
    const ttl = await redis.ttl(key);

    res.setHeader('X-Free-Quota-Limit',     FREE_LIMIT);
    res.setHeader('X-Free-Quota-Remaining', Math.max(0, FREE_LIMIT - current));
    res.setHeader('X-Free-Quota-Reset',     `${ttl}s`);

    if (current > FREE_LIMIT) {
      return res.status(429).json({
        error:    'Quota gratuit épuisé (3 vérifications / 24h). Créez un compte pour continuer.',
        limit:    FREE_LIMIT,
        reset_in: `${ttl}s`,
      });
    }

    next();

  } catch (err) {
    console.error('[freeQuota] Redis indisponible :', err.message);
    res.status(503).json({ error: 'Service temporairement indisponible' });
  }
}

module.exports = freeQuota;
