const { getRedis } = require('../utils/redis');

const WINDOW_SECONDS = 60; // fenêtre glissante d'1 minute

// INCR, EXPIRE (à la première requête de la fenêtre) et TTL en UN seul aller-retour, exécutés de
// façon atomique côté Redis. Avant : 2 à 3 appels séquentiels sur le chemin critique de CHAQUE
// requête, soit autant d'attentes réseau ajoutées à la latence.
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { current, redis.call('TTL', KEYS[1]) }`;

function hit(redis, key) {
  if (!redis.rateLimitHit) redis.defineCommand('rateLimitHit', { numberOfKeys: 1, lua: RATE_LIMIT_SCRIPT });
  return redis.rateLimitHit(key, WINDOW_SECONDS);
}

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
    // L'incrément est atomique (script Lua) — évite les race conditions
    const [current, ttl] = await hit(redis, redisKey);

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
