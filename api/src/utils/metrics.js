const promClient = require('prom-client');

// Registre global Prometheus — collecte toutes les métriques
const register = promClient.register;

// Métriques système par défaut (CPU, mémoire, event loop Node.js)
promClient.collectDefaultMetrics({ register });

// ── Métrique 1 : Compteur de requêtes HTTP ───────────────────────────────────
// Compte chaque requête reçue, classée par méthode, route et code HTTP
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP reçues',
  labelNames: ['method', 'route', 'status'],
});

// ── Métrique 2 : Histogramme de latence ─────────────────────────────────────
// Mesure la durée de chaque requête → permet de calculer p50, p95, p99
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5], // seuils en secondes
});

// ── Métrique 3 : Compteur de verdicts ────────────────────────────────────────
// Compte les verdicts produits (VALID, SUSPICIOUS, INVALID)
const verdictsTotal = new promClient.Counter({
  name: 'mailguard_verdicts_total',
  help: 'Nombre de verdicts par catégorie',
  labelNames: ['verdict'],
});

// ── Métrique 4 : Hits/misses du cache Redis ──────────────────────────────────
const cacheHitsTotal = new promClient.Counter({
  name: 'mailguard_cache_hits_total',
  help: 'Nombre de résultats servis depuis le cache Redis',
});

const cacheMissesTotal = new promClient.Counter({
  name: 'mailguard_cache_misses_total',
  help: 'Nombre de résultats non trouvés en cache',
});

// ── Middleware Express ────────────────────────────────────────────────────────
// Inséré dans app.js pour mesurer automatiquement chaque requête
function httpMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route    = req.route ? req.route.path : req.path;

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status: res.statusCode,
    });

    httpRequestDuration.observe(
      { method: req.method, route, status: res.statusCode },
      duration
    );
  });

  next();
}

module.exports = {
  register,
  httpMiddleware,
  verdictsTotal,
  cacheHitsTotal,
  cacheMissesTotal,
};
