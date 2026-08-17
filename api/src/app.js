require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const path    = require('path');
const fs      = require('fs');

// Swagger UI — optionnel (disponible après npm install)
let swaggerUi, yaml;
try {
  swaggerUi = require('swagger-ui-express');
  yaml      = require('js-yaml');
} catch (_) { /* swagger non installé — UI désactivée */ }

const connectMongo              = require('./utils/db');
const connectRedis              = require('./utils/redis');
const metrics                   = require('./utils/metrics');
const { importDomains }         = require('../scripts/importDomains');

const authRoutes      = require('./routes/auth');
const meRoutes        = require('./routes/me');
const verifyRoutes    = require('./routes/verify');
const reportRoutes    = require('./routes/report');
const statsRoutes     = require('./routes/stats');
const webhookRoutes   = require('./routes/webhook');
const blacklistRoutes = require('./routes/routeblacklist');
const healthRoutes    = require('./routes/health');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares globaux ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP désactivé pour Swagger UI
app.use(express.json());

// ── Métriques Prometheus ──────────────────────────────────────────────────────
app.use(metrics.httpMiddleware);

// ── Swagger UI ────────────────────────────────────────────────────────────────
// Accessible sur GET /api-docs (disponible après sudo npm install)
if (swaggerUi && yaml) {
  const openapiPath = '/docs/openapi.yaml';
  if (fs.existsSync(openapiPath)) {
    const swaggerDocument = yaml.load(fs.readFileSync(openapiPath, 'utf8'));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', meRoutes);
app.use('/api/v1', verifyRoutes);
app.use('/api/v1', reportRoutes);
app.use('/api/v1', statsRoutes);
app.use('/api/v1', webhookRoutes);
app.use('/api/v1', blacklistRoutes);
app.use('/api/v1', healthRoutes);

// Endpoint Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
async function start() {
  await connectMongo();
  await connectRedis();

  // Alimenter la blacklist si la collection domains est vide
  importDomains().catch(err =>
    console.warn('[startup] Import domaines échoué (réseau?) :', err.message)
  );

  app.listen(PORT, () => {
    console.log(`MailGuard API démarrée sur le port ${PORT}`);
  });
}

// Ne démarre le serveur que si le fichier est exécuté directement (pas importé par Jest)
if (require.main === module) {
  start();
}

module.exports = app;
