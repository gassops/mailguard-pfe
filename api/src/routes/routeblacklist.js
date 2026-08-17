const express  = require('express');
const router   = express.Router();

const auth      = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const Domain    = require('../models/Domain');

// GET /api/v1/domains/blacklist
router.get('/domains/blacklist', auth, rateLimit, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  const skip  = (page - 1) * limit;

  try {
    const [domains, total] = await Promise.all([
      Domain.find({ isDisposable: true, active: true })
        .select('domain source reportCount addedAt')
        .sort({ addedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Domain.countDocuments({ isDisposable: true, active: true }),
    ]);

    res.json({
      total,
      page,
      pages: Math.ceil(total / limit),
      domains,
    });

  } catch (err) {
    console.error('[/domains/blacklist]', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
