const express      = require('express');
const router       = express.Router();

const auth         = require('../middleware/auth');
const rateLimit    = require('../middleware/rateLimit');
const quota        = require('../middleware/quota');
const freeQuota    = require('../middleware/freeQuota');
const Client       = require('../models/Client');
const { getRedis } = require('../utils/redis');
const metrics      = require('../utils/metrics');
const Verification = require('../models/Verification');
const { aggregate } = require('../services/scoreAggregator');

const blacklist   = require('../modules/blacklist');
const mx          = require('../modules/mx');
const smtp        = require('../modules/smtp');
const domainAge   = require('../modules/domainAge');
const ml          = require('../modules/ml');
const crowdsource = require('../modules/crowdsource');

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10);

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────────────────────────

function extractDomain(email) {
  return email.split('@')[1]?.toLowerCase() || null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Lance les 6 modules d'analyse et retourne leurs résultats.
 * Stratégie en 2 phases pour que smtp puisse utiliser le serveur MX réel :
 *   Phase 1 (parallèle) : blacklist, mx, domainAge, ml, crowdsource
 *   Phase 2             : smtp (utilise mx.mx du résultat phase 1)
 */
async function runAnalysis(email, domain) {
  const [blacklistResult, mxResult, domainAgeResult, mlResult, crowdsourceResult] =
    await Promise.all([
      blacklist.analyze(email, domain),
      mx.analyze(domain),
      domainAge.analyze(domain),
      ml.analyze(email, domain),
      crowdsource.analyze(email, domain),
    ]);

  const smtpResult = await smtp.analyze(email, mxResult.mx);

  return { blacklist: blacklistResult, mx: mxResult, smtp: smtpResult,
           domainAge: domainAgeResult, ml: mlResult, crowdsource: crowdsourceResult };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify', auth, rateLimit, quota, async (req, res) => {
  const start = Date.now();
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Champ "email" invalide ou manquant' });
  }

  const emailNorm = email.toLowerCase().trim();
  const domain    = extractDomain(emailNorm);

  if (!domain) {
    return res.status(400).json({ error: 'Domaine introuvable dans l\'email' });
  }

  const redis    = getRedis();
  const cacheKey = `verify:${emailNorm}`;

  try {
    // ── Cache Redis ────────────────────────────────────────────────────────────
    const cached = await redis.get(cacheKey);
    if (cached) {
      metrics.cacheHitsTotal.inc();
      return res.json({ ...JSON.parse(cached), cached: true });
    }
    metrics.cacheMissesTotal.inc();

    // ── Analyse ────────────────────────────────────────────────────────────────
    const moduleResults = await runAnalysis(emailNorm, domain);
    const { score, verdict, reasons, details } = aggregate(
      moduleResults,
      req.client.thresholds
    );

    const processingTimeMs = Date.now() - start;

    const response = {
      email:   emailNorm,
      domain,
      verdict,
      score,
      details,
      reasons,
      cached:          false,
      processingTimeMs,
    };

    // ── Persistance MongoDB ────────────────────────────────────────────────────
    await Verification.create({
      clientId:  req.client._id,
      email:     emailNorm,
      domain,
      score,
      verdict,
      details,
      processingTimeMs,
      cached: false,
    });

    // ── Consommation du quota mensuel ──────────────────────────────────────────
    const updated = await Client.findByIdAndUpdate(
      req.client._id,
      { $inc: { quotaUsed: 1 } },
      { new: true }
    );
    const newRemaining = Math.max(0, (updated?.quotaLimit ?? req.client.quotaLimit ?? 100) - (updated?.quotaUsed ?? (req.client.quotaUsed ?? 0) + 1));
    res.setHeader('X-Quota-Remaining', newRemaining);

    // ── Invalidation du cache stats (pour refresh immédiat côté dashboard) ────
    await redis.del(`stats:${req.client._id}:30`);

    // ── Mise en cache ──────────────────────────────────────────────────────────
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));

    // ── Métriques ──────────────────────────────────────────────────────────────
    metrics.verdictsTotal.inc({ verdict });

    return res.json(response);

  } catch (err) {
    console.error('[/verify]', err.message);
    res.status(500).json({ error: 'Erreur interne lors de la vérification' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify/free — vérification anonyme, sans compte (3 / 24h par IP)
// Même pipeline d'analyse que /verify, mais pas de clé API, pas de quota
// mensuel Client, pas de persistance en base (essais anonymes non liés à
// un client). Protégé par freeQuota (compteur Redis par IP).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify/free', freeQuota, async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Champ "email" invalide ou manquant' });
  }

  const emailNorm = email.toLowerCase().trim();
  const domain    = extractDomain(emailNorm);

  if (!domain) {
    return res.status(400).json({ error: 'Domaine introuvable dans l\'email' });
  }

  const redis    = getRedis();
  const cacheKey = `verify:${emailNorm}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      metrics.cacheHitsTotal.inc();
      return res.json({ ...JSON.parse(cached), cached: true });
    }
    metrics.cacheMissesTotal.inc();

    const moduleResults = await runAnalysis(emailNorm, domain);
    const { score, verdict, reasons, details } = aggregate(moduleResults);

    const response = {
      email:   emailNorm,
      domain,
      verdict,
      score,
      details,
      reasons,
      cached: false,
    };

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));
    metrics.verdictsTotal.inc({ verdict });

    return res.json(response);

  } catch (err) {
    console.error('[/verify/free]', err.message);
    res.status(500).json({ error: 'Erreur interne lors de la vérification' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify/bulk
// ─────────────────────────────────────────────────────────────────────────────

router.post('/verify/bulk', auth, rateLimit, async (req, res) => {
  const { emails } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'Champ "emails" doit être un tableau non vide' });
  }

  if (emails.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 emails par requête bulk' });
  }

  // Appel séquentiel contrôlé pour éviter de saturer DNS / SMTP
  const results = [];
  for (const email of emails) {
    if (!isValidEmail(email)) {
      results.push({ email, error: 'Format invalide' });
      continue;
    }

    const emailNorm = email.toLowerCase().trim();
    const domain    = extractDomain(emailNorm);
    const redis     = getRedis();
    const cacheKey  = `verify:${emailNorm}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        metrics.cacheHitsTotal.inc();
        results.push({ ...JSON.parse(cached), cached: true });
        continue;
      }

      metrics.cacheMissesTotal.inc();
      const moduleResults = await runAnalysis(emailNorm, domain);
      const { score, verdict, reasons, details } = aggregate(
        moduleResults,
        req.client.thresholds
      );

      const response = { email: emailNorm, domain, verdict, score, details, reasons, cached: false };

      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));
      metrics.verdictsTotal.inc({ verdict });
      results.push(response);

    } catch (err) {
      results.push({ email: emailNorm, error: 'Erreur lors de la vérification' });
    }
  }

  res.json({ total: results.length, results });
});

module.exports = router;
