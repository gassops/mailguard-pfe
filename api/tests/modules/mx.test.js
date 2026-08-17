/**
 * Tests unitaires — Module 2 : MX Record Validation
 * On mock le module dns natif pour tester sans résolution réseau
 */

jest.mock('dns', () => ({
  promises: {
    resolveMx: jest.fn(),
  },
}));

const dns = require('dns').promises;
const { analyze, BLACKLISTED_MX_SERVERS } = require('../../src/modules/mx');

describe('analyze() — MX Record Validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retourne valid=true et score=0 pour un domaine avec MX valide', async () => {
    dns.resolveMx.mockResolvedValue([
      { exchange: 'alt1.gmail-smtp-in.l.google.com', priority: 5 },
      { exchange: 'gmail-smtp-in.l.google.com', priority: 10 },
    ]);

    const result = await analyze('gmail.com');

    expect(result.valid).toBe(true);
    expect(result.score).toBe(0);
    expect(result.mx).toBe('alt1.gmail-smtp-in.l.google.com');
  });

  test('retourne valid=false et score=20 si aucun enregistrement MX', async () => {
    dns.resolveMx.mockResolvedValue([]);

    const result = await analyze('nodomain.xyz');

    expect(result.valid).toBe(false);
    expect(result.score).toBe(20);
    expect(result.reasons[0]).toContain('Aucun enregistrement MX');
  });

  test('retourne valid=false et score=20 si DNS ENOTFOUND', async () => {
    const err = new Error('DNS lookup failed');
    err.code = 'ENOTFOUND';
    dns.resolveMx.mockRejectedValue(err);

    const result = await analyze('doesnotexist.fake');

    expect(result.valid).toBe(false);
    expect(result.score).toBe(20);
    expect(result.reasons[0]).toContain('ENOTFOUND');
  });

  test('retourne valid=false et score=10 pour une erreur DNS non critique', async () => {
    const err = new Error('unknown error');
    err.code = 'EUNKNOWN';
    dns.resolveMx.mockRejectedValue(err);

    const result = await analyze('weirdomain.com');

    expect(result.valid).toBe(false);
    expect(result.score).toBe(10);
  });

  test('retourne valid=false et score=20 pour un MX blacklisté', async () => {
    dns.resolveMx.mockResolvedValue([
      { exchange: 'mx.mailinator.com', priority: 10 },
    ]);

    const result = await analyze('mailinator.com');

    expect(result.valid).toBe(false);
    expect(result.score).toBe(20);
    expect(result.reasons[0]).toContain('jetable');
  });

  test('sélectionne le MX avec la priorité la plus basse (serveur principal)', async () => {
    dns.resolveMx.mockResolvedValue([
      { exchange: 'mx2.example.com', priority: 20 },
      { exchange: 'mx1.example.com', priority: 10 },
    ]);

    const result = await analyze('example.com');

    expect(result.mx).toBe('mx1.example.com');
  });

  test('normalise le MX en minuscules et sans point final', async () => {
    dns.resolveMx.mockResolvedValue([
      { exchange: 'MX.EXAMPLE.COM.', priority: 10 },
    ]);

    const result = await analyze('example.com');

    expect(result.mx).toBe('mx.example.com');
  });
});
