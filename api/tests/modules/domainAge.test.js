/**
 * Tests unitaires — Module 4 : Domain Age Check
 * On mock le module whois pour tester sans réseau
 */

jest.mock('whois');
const whois = require('whois');
const { analyze, parseCreationDate, getRiskLevel } = require('../../src/modules/domainAge');

// ── getRiskLevel ──────────────────────────────────────────────────────────────

describe('getRiskLevel()', () => {
  test('> 730 jours → score 0, LOW', () => {
    expect(getRiskLevel(800)).toEqual({ score: 0, riskLevel: 'LOW' });
  });

  test('180-730 jours → score 3, MODERATE', () => {
    expect(getRiskLevel(400)).toEqual({ score: 3, riskLevel: 'MODERATE' });
  });

  test('30-180 jours → score 7, HIGH', () => {
    expect(getRiskLevel(90)).toEqual({ score: 7, riskLevel: 'HIGH' });
  });

  test('≤ 30 jours → score 10, VERY_HIGH', () => {
    expect(getRiskLevel(15)).toEqual({ score: 10, riskLevel: 'VERY_HIGH' });
  });

  test('0 jour → score 10, VERY_HIGH', () => {
    expect(getRiskLevel(0)).toEqual({ score: 10, riskLevel: 'VERY_HIGH' });
  });
});

// ── parseCreationDate ─────────────────────────────────────────────────────────

describe('parseCreationDate()', () => {
  test('parse "Creation Date: 2020-01-15T00:00:00Z"', () => {
    const raw = 'Creation Date: 2020-01-15T00:00:00Z\nRegistrar: Test';
    const date = parseCreationDate(raw);
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(2020);
  });

  test('parse "created: 2019-03-22"', () => {
    const raw = 'created: 2019-03-22\nexpires: 2025-03-22';
    const date = parseCreationDate(raw);
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(2019);
  });

  test('retourne null si aucune date trouvée', () => {
    expect(parseCreationDate('No date here')).toBeNull();
  });

  test('retourne null pour une date invalide', () => {
    expect(parseCreationDate('Creation Date: not-a-date')).toBeNull();
  });
});

// ── analyze ───────────────────────────────────────────────────────────────────

describe('analyze()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retourne score=0 pour un domaine ancien (>2 ans)', async () => {
    whois.lookup.mockImplementation((domain, opts, cb) => {
      cb(null, 'Creation Date: 2015-06-10T00:00:00Z\n');
    });

    const result = await analyze('gmail.com');
    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe('LOW');
    expect(result.days).toBeGreaterThan(730);
  });

  test('retourne score=10 pour un domaine très récent (<1 mois)', async () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString();
    whois.lookup.mockImplementation((domain, opts, cb) => {
      cb(null, `Creation Date: ${recent}\n`);
    });

    const result = await analyze('newdomain.xyz');
    expect(result.score).toBe(10);
    expect(result.riskLevel).toBe('VERY_HIGH');
  });

  test('retourne score=5 et UNKNOWN si date introuvable', async () => {
    whois.lookup.mockImplementation((domain, opts, cb) => {
      cb(null, 'Registrar: Some Registrar\n');
    });

    const result = await analyze('nodatadomain.com');
    expect(result.score).toBe(5);
    expect(result.riskLevel).toBe('UNKNOWN');
  });

  test('retourne score=5 et UNKNOWN si WHOIS échoue', async () => {
    whois.lookup.mockImplementation((domain, opts, cb) => {
      cb(new Error('Connection timeout'), null);
    });

    const result = await analyze('timeout.com');
    expect(result.score).toBe(5);
    expect(result.riskLevel).toBe('UNKNOWN');
    expect(result.reasons[0]).toContain('WHOIS');
  });
});
