const { getRedis } = require('../utils/redis');

const WINDOW_SECONDS = 60; // fenêtre glissante d'1 minute

/**
 * Middleware de rate limiting par clé API — basé sur Redis.
 *
 * Utilise un compteur Redis avec TTL :
 *   clé  : ratelimit:<clientId>
 *   valeur : nombre de requêtes dans la fenêtre de 60s
 *
 * Si le compteur dépasse client.rateLimitPerMin → 429 Too Many Requests.
 * Ajoute les headers standards de rate limiting dans la réponse.
 *
 * Doit être utilisé APRÈS le middleware auth (nécessite req.client).
 */
async function rateLimit(req, res, next) {
  const redis     = getRedis();
  const clientId  = req.client._id.toString();
  const limit     = req.client.rateLimitPerMin || 100;
  const redisKey  = `ratelimit:${clientId}`;

  try {
    // INCR est atomique — évite les race conditions
    const current = await redis.incr(redisKey);

    // Première requête de la fenêtre → définir le TTL
    if (current === 1) {
      await redis.expire(redisKey, WINDOW_SECONDS);
    }

    const ttl = await redis.ttl(redisKey);

    // Headers standards (RFC 6585)
    res.setHeader('X-RateLimit-Limit',     limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    res.setHeader('X-RateLimit-Reset',     Math.floor(Date.now() / 1000) + ttl);

    if (current > limit) {
      return res.status(429).json({
        error:       'Quota dépassé',
        limit,
        reset_in:    `${ttl}s`,
      });
    }

    next();

  } catch (err) {
    // Fail-open : si Redis est down, on laisse passer la requête
    console.error('[rateLimit] Redis indisponible :', err.message);
    next();
  }
}

module.exports = rateLimit;
