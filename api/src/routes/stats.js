const express      = require('express');
const router       = express.Router();

const auth         = require('../middleware/auth');
const rateLimit    = require('../middleware/rateLimit');
const { getRedis } = require('../utils/redis');
const Verification = require('../models/Verification');

const STATS_CACHE_TTL = 300; // 5 minutes

// GET /api/v1/stats
router.get('/stats', auth, rateLimit, async (req, res) => {
  const days    = parseInt(req.query.periode || '30', 10);
  const redis   = getRedis();
  const cacheKey = `stats:${req.client._id}:${days}`;

  try {
    // Cache Redis 5 minutes
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const since = new Date(Date.now() - days * 86400000);

    const [total, byVerdict, avgLatency] = await Promise.all([
      // Total vérifications
      Verification.countDocuments({ clientId: req.client._id, createdAt: { $gte: since } }),

      // Répartition par verdict
      Verification.aggregate([
        { $match: { clientId: req.client._id, createdAt: { $gte: since } } },
        { $group: { _id: '$verdict', count: { $sum: 1 } } },
      ]),

      // Latence moyenne
      Verification.aggregate([
        { $match: { clientId: req.client._id, createdAt: { $gte: since } } },
        { $group: { _id: null, avg: { $avg: '$processingTimeMs' } } },
      ]),
    ]);

    const verdicts = { VALID: 0, SUSPICIOUS: 0, INVALID: 0 };
    byVerdict.forEach(({ _id, count }) => { verdicts[_id] = count; });

    const response = {
      periode_jours:  days,
      total,
      verdicts,
      latence_moyenne_ms: Math.round(avgLatency[0]?.avg || 0),
    };

    await redis.setex(cacheKey, STATS_CACHE_TTL, JSON.stringify(response));
    res.json(response);

  } catch (err) {
    console.error('[/stats]', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
