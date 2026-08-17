/**
 * Tests d'intégration — API MailGuard
 *
 * MongoDB RÉEL  → mailguard_test  (base isolée, vidée avant chaque suite)
 * Redis RÉEL    → localhost:6379  db 1  (isolé de la prod db 0)
 *
 * Modules mockés (appels réseau externes — lents / non déterministes en CI) :
 *   mx, smtp, domainAge, ml
 *
 * Modules réels (MongoDB pur — rapides et déterministes) :
 *   blacklist, crowdsource
 */

// ── Env vars — AVANT tout require pour que les modules lisent les bonnes valeurs ──
process.env.MONGO_URI  = 'mongodb://localhost:27017/mailguard_test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_DB   = '1';   // db Redis isolée de la prod
process.env.NODE_ENV   = 'test';

// ── Mocks — uniquement les modules qui font des appels réseau externes ─────────
jest.mock('../../src/modules/mx', () => ({
  analyze: jest.fn().mockResolvedValue({
    score: 0, valid: true, mx: 'mx.gmail.com',
    records: ['mx.gmail.com'], serverResponds: true, reasons: [],
  }),
}));
jest.mock('../../src/modules/smtp', () => ({
  analyze: jest.fn().mockResolvedValue({
    score: 0, exists: true, status: 'EXISTS', responseCode: 250, reasons: [],
  }),
}));
jest.mock('../../src/modules/domainAge', () => ({
  analyze: jest.fn().mockResolvedValue({
    score: 0, days: 2000, riskLevel: 'LOW', createdAt: '2017-01-01', registrar: 'GoDaddy', reasons: [],
  }),
}));
jest.mock('../../src/modules/ml', () => ({
  analyze: jest.fn().mockResolvedValue({
    score: 0, probability: 0.02, is_disposable: false, topFeatures: [], reasons: [],
  }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────
const request      = require('supertest');
const mongoose     = require('mongoose');
const connectMongo = require('../../src/utils/db');
const connectRedis = require('../../src/utils/redis');
const Client       = require('../../src/models/Client');
const Verification = require('../../src/models/Verification');
const Report       = require('../../src/models/Report');
const Webhook      = require('../../src/models/Webhook');
const Domain       = require('../../src/models/Domain');
const app          = require('../../src/app');

// ── State partagé entre les suites ───────────────────────────────────────────
let testClient;
let apiKey;

// ── Cycle de vie global ───────────────────────────────────────────────────────

beforeAll(async () => {
  await connectMongo();
  await connectRedis();

  // Vider les collections de test (pas les domaines — on garde les 185K si disponibles)
  await Promise.all([
    Client.deleteMany({}),
    Verification.deleteMany({}),
    Report.deleteMany({}),
    Webhook.deleteMany({}),
  ]);

  // Créer un client de test avec un quota élevé pour ne pas bloquer les tests
  testClient = await Client.create({
    name:       'Test Client',
    email:      'test@mailguard.dev',
    password:   'TestPassword123!',
    quotaLimit: 10000,
  });
  apiKey = testClient.apiKey;
}, 30000);

afterAll(async () => {
  const { getRedis } = require('../../src/utils/redis');
  try { await getRedis().flushdb(); } catch {}

  await Promise.all([
    Client.deleteMany({}),
    Verification.deleteMany({}),
    Report.deleteMany({}),
    Webhook.deleteMany({}),
  ]);

  await mongoose.connection.close();
}, 15000);

beforeEach(async () => {
  // État propre pour chaque test :
  // - reset quota
  // - vider le cache Redis (db 1)
  // - vider les vérifications et signalements
  const { getRedis } = require('../../src/utils/redis');
  await Promise.all([
    Client.updateOne({ _id: testClient._id }, { $set: { quotaUsed: 0, quotaLimit: 10000 } }),
    getRedis().flushdb(),
    Verification.deleteMany({ clientId: testClient._id }),
    Report.deleteMany({ clientId: testClient._id }),
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/health
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/health', () => {
  test('retourne 200 sans clé API', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('retourne un timestamp ISO valide', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body.timestamp).toBeDefined();
    expect(() => new Date(res.body.timestamp)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware AUTH — requête réelle vers MongoDB
// ─────────────────────────────────────────────────────────────────────────────

describe('Middleware Auth', () => {
  test('401 si header X-API-Key absent', async () => {
    const res = await request(app).post('/api/v1/verify').send({ email: 'a@b.com' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('401 si clé inexistante en base', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', 'mg_cle_qui_nexiste_pas_du_tout')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(401);
  });

  test('authentification réussie avec la vraie clé MongoDB', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/verify', () => {
  test('400 si email absent', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 si email invalide', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'pas-un-email' });
    expect(res.status).toBe(400);
  });

  test('200 — structure de réponse complète', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email:   'user@gmail.com',
      domain:  'gmail.com',
      verdict: expect.stringMatching(/^(VALID|SUSPICIOUS|INVALID)$/),
      score:   expect.any(Number),
    });
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(res.body.details).toBeDefined();
    expect(res.body.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  test('normalise l\'email en minuscules', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'User@Gmail.COM' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('user@gmail.com');
  });

  // ── Persistance MongoDB ──────────────────────────────────────────────────────

  test('persiste le résultat dans la collection verifications', async () => {
    await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    const doc = await Verification.findOne({ email: 'user@gmail.com', clientId: testClient._id });
    expect(doc).not.toBeNull();
    expect(doc.verdict).toMatch(/^(VALID|SUSPICIOUS|INVALID)$/);
    expect(doc.score).toBeGreaterThanOrEqual(0);
  });

  test('incrémente quotaUsed dans le document Client', async () => {
    await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    const updated = await Client.findById(testClient._id);
    expect(updated.quotaUsed).toBe(1);
  });

  test('3 vérifications → quotaUsed = 3', async () => {
    for (const email of ['a@gmail.com', 'b@gmail.com', 'c@gmail.com']) {
      await request(app)
        .post('/api/v1/verify')
        .set('X-API-Key', apiKey)
        .send({ email });
    }
    const updated = await Client.findById(testClient._id);
    expect(updated.quotaUsed).toBe(3);
  });

  // ── Cache Redis ──────────────────────────────────────────────────────────────

  test('2e appel identique → cached=true (Redis réel)', async () => {
    await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    const res2 = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    expect(res2.status).toBe(200);
    expect(res2.body.cached).toBe(true);
  });

  test('résultat caché en Redis contient les bonnes données', async () => {
    const res1 = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    const { getRedis } = require('../../src/utils/redis');
    const raw    = await getRedis().get('verify:user@gmail.com');
    const cached = JSON.parse(raw);

    expect(cached.email).toBe('user@gmail.com');
    expect(cached.verdict).toBe(res1.body.verdict);
    expect(cached.score).toBe(res1.body.score);
  });

  // ── Quota MongoDB ────────────────────────────────────────────────────────────

  test('429 si quota épuisé (quotaUsed >= quotaLimit en MongoDB)', async () => {
    await Client.updateOne(
      { _id: testClient._id },
      { $set: { quotaUsed: 100, quotaLimit: 100 } }
    );

    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBeDefined();
  });

  test('retourne les headers X-Quota-*', async () => {
    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com' });

    expect(res.headers['x-quota-limit']).toBeDefined();
    expect(res.headers['x-quota-remaining']).toBeDefined();
  });

  // ── Blacklist MongoDB réelle ─────────────────────────────────────────────────

  test('détecte un domaine jetable via la collection domains (MongoDB)', async () => {
    // S'assurer que le domaine est présent dans la collection de test
    await Domain.findOneAndUpdate(
      { domain: 'yopmail.com' },
      { $setOnInsert: { domain: 'yopmail.com', isDisposable: true, source: 'github', active: true } },
      { upsert: true }
    );

    const res = await request(app)
      .post('/api/v1/verify')
      .set('X-API-Key', apiKey)
      .send({ email: 'test@yopmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('INVALID');
    expect(res.body.details.blacklist.flagged).toBe(true);
    expect(res.body.details.blacklist.score).toBe(50);
  });

  // ── Plusieurs domaines jetables connus, dont des domaines Temp-Mail ─────────
  // Résultat attendu pour chacun : détecté par la blacklist (flagged=true,
  // score=50/50). Poids blacklist = 0.55 → un domaine connu dépasse TOUJOURS
  // le seuil INVALID (51) à lui seul, quels que soient les autres modules.
  describe('domaines jetables connus (incl. Temp-Mail)', () => {
    const KNOWN_DISPOSABLE_DOMAINS = [
      'mailinator.com',
      'guerrillamail.com',
      'sharklasers.com',
      '10minutemail.com',
      'temp-mail.org',   // domaine principal du service Temp-Mail
      'jobraux.com',     // domaine de rotation observé chez Temp-Mail
    ];

    test.each(KNOWN_DISPOSABLE_DOMAINS)(
      '%s → blacklist flagged, score élevé, verdict INVALID',
      async (domain) => {
        await Domain.findOneAndUpdate(
          { domain },
          { $setOnInsert: { domain, isDisposable: true, source: 'test', active: true } },
          { upsert: true }
        );

        const res = await request(app)
          .post('/api/v1/verify')
          .set('X-API-Key', apiKey)
          .send({ email: `randomuser42@${domain}` });

        expect(res.status).toBe(200);
        expect(res.body.details.blacklist.flagged).toBe(true);
        expect(res.body.details.blacklist.score).toBe(50);
        expect(res.body.score).toBeGreaterThanOrEqual(51); // dépasse le seuil INVALID à lui seul
        expect(res.body.verdict).toBe('INVALID');
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/verify/bulk
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/verify/bulk', () => {
  test('400 si emails absent', async () => {
    const res = await request(app)
      .post('/api/v1/verify/bulk')
      .set('X-API-Key', apiKey)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 si plus de 50 emails', async () => {
    const emails = Array.from({ length: 51 }, (_, i) => `user${i}@gmail.com`);
    const res = await request(app)
      .post('/api/v1/verify/bulk')
      .set('X-API-Key', apiKey)
      .send({ emails });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50/);
  });

  test('200 — tableau de résultats complet', async () => {
    const res = await request(app)
      .post('/api/v1/verify/bulk')
      .set('X-API-Key', apiKey)
      .send({ emails: ['user@gmail.com', 'test@yahoo.com'] });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.results).toHaveLength(2);
    res.body.results.forEach(r => {
      expect(r.verdict).toMatch(/^(VALID|SUSPICIOUS|INVALID)$/);
    });
  });

  test('gère les emails invalides dans le tableau', async () => {
    const res = await request(app)
      .post('/api/v1/verify/bulk')
      .set('X-API-Key', apiKey)
      .send({ emails: ['valid@gmail.com', 'invalide-sans-arobase'] });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.results[1].error).toBeDefined();
  });

  test('2e appel bulk utilise le cache Redis', async () => {
    const payload = { emails: ['user@gmail.com'] };
    await request(app).post('/api/v1/verify/bulk').set('X-API-Key', apiKey).send(payload);
    const res2 = await request(app).post('/api/v1/verify/bulk').set('X-API-Key', apiKey).send(payload);

    expect(res2.body.results[0].cached).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/report
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/report', () => {
  test('400 si champs manquants', async () => {
    const res = await request(app)
      .post('/api/v1/report')
      .set('X-API-Key', apiKey)
      .send({ email: 'a@b.com' }); // type manquant
    expect(res.status).toBe(400);
  });

  test('400 si type invalide', async () => {
    const res = await request(app)
      .post('/api/v1/report')
      .set('X-API-Key', apiKey)
      .send({ email: 'a@b.com', type: 'MAUVAIS_TYPE' });
    expect(res.status).toBe(400);
  });

  test('201 et document créé en MongoDB', async () => {
    const res = await request(app)
      .post('/api/v1/report')
      .set('X-API-Key', apiKey)
      .send({ email: 'user@gmail.com', type: 'FALSE_POSITIVE' });

    expect(res.status).toBe(201);

    const doc = await Report.findOne({ email: 'user@gmail.com', clientId: testClient._id });
    expect(doc).not.toBeNull();
    expect(doc.type).toBe('FALSE_POSITIVE');
  });

  test('409 si déjà signalé — vérifié via MongoDB', async () => {
    await request(app)
      .post('/api/v1/report')
      .set('X-API-Key', apiKey)
      .send({ email: 'dup@gmail.com', type: 'FALSE_NEGATIVE' });

    const res2 = await request(app)
      .post('/api/v1/report')
      .set('X-API-Key', apiKey)
      .send({ email: 'dup@gmail.com', type: 'FALSE_NEGATIVE' });

    expect(res2.status).toBe(409);

    // Vérifier qu'un seul document existe en base
    const count = await Report.countDocuments({ email: 'dup@gmail.com', clientId: testClient._id });
    expect(count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/stats
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/stats', () => {
  test('200 — structure correcte avec collection vide', async () => {
    const res = await request(app)
      .get('/api/v1/stats')
      .set('X-API-Key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('verdicts');
    expect(res.body.verdicts).toHaveProperty('VALID');
    expect(res.body.verdicts).toHaveProperty('SUSPICIOUS');
    expect(res.body.verdicts).toHaveProperty('INVALID');
    expect(res.body).toHaveProperty('latence_moyenne_ms');
  });

  test('reflète les vraies vérifications insérées en MongoDB', async () => {
    await Verification.create([
      { clientId: testClient._id, email: 'a@gmail.com', domain: 'gmail.com', score: 2,  verdict: 'VALID',      processingTimeMs: 100 },
      { clientId: testClient._id, email: 'b@spam.com',  domain: 'spam.com',  score: 80, verdict: 'INVALID',    processingTimeMs: 200 },
      { clientId: testClient._id, email: 'c@susp.com',  domain: 'susp.com',  score: 35, verdict: 'SUSPICIOUS',  processingTimeMs: 150 },
    ]);

    const res = await request(app)
      .get('/api/v1/stats')
      .set('X-API-Key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.verdicts.VALID).toBeGreaterThanOrEqual(1);
    expect(res.body.verdicts.INVALID).toBeGreaterThanOrEqual(1);
    expect(res.body.verdicts.SUSPICIOUS).toBeGreaterThanOrEqual(1);
  });

  test('respecte le paramètre ?periode=7', async () => {
    const res = await request(app)
      .get('/api/v1/stats?periode=7')
      .set('X-API-Key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body.periode_jours).toBe(7);
  });

  test('isole les stats par clientId — pas de fuite entre clients', async () => {
    const other = await Client.create({
      name: 'Autre Client', email: 'other@test.dev', password: 'OtherPwd123!',
    });
    await Verification.create({
      clientId: other._id, email: 'x@other.com', domain: 'other.com',
      score: 90, verdict: 'INVALID', processingTimeMs: 50,
    });

    const res = await request(app)
      .get('/api/v1/stats')
      .set('X-API-Key', apiKey);

    // Les vérifications du client "other" ne doivent pas apparaître
    // dans les stats du client de test
    expect(res.body.total).toBe(0); // beforeEach a vidé les verifs du testClient

    await Client.deleteOne({ _id: other._id });
    await Verification.deleteOne({ clientId: other._id });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhook
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/webhook', () => {
  test('400 si URL non HTTPS', async () => {
    const res = await request(app)
      .post('/api/v1/webhook')
      .set('X-API-Key', apiKey)
      .send({ url: 'http://example.com/hook' });
    expect(res.status).toBe(400);
  });

  test('400 si événement invalide', async () => {
    const res = await request(app)
      .post('/api/v1/webhook')
      .set('X-API-Key', apiKey)
      .send({ url: 'https://example.com/hook', events: ['INVALIDE'] });
    expect(res.status).toBe(400);
  });

  test('201 — document créé en MongoDB', async () => {
    const res = await request(app)
      .post('/api/v1/webhook')
      .set('X-API-Key', apiKey)
      .send({ url: 'https://example.com/hook', events: ['INVALID'] });

    expect(res.status).toBe(201);
    expect(res.body.webhook.url).toBe('https://example.com/hook');

    const doc = await Webhook.findOne({ clientId: testClient._id });
    expect(doc).not.toBeNull();
    expect(doc.url).toBe('https://example.com/hook');
    expect(doc.events).toContain('INVALID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/domains/blacklist
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/domains/blacklist', () => {
  test('200 — structure paginée correcte', async () => {
    const res = await request(app)
      .get('/api/v1/domains/blacklist')
      .set('X-API-Key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('pages');
    expect(Array.isArray(res.body.domains)).toBe(true);
  });

  test('total reflète les documents réels en MongoDB', async () => {
    const countInDb = await Domain.countDocuments({ isDisposable: true, active: true });
    const res = await request(app)
      .get('/api/v1/domains/blacklist')
      .set('X-API-Key', apiKey);

    expect(res.body.total).toBe(countInDb);
  });
});
