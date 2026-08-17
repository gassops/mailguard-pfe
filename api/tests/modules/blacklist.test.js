/**
 * Tests unitaires — Module 1 : Domain Blacklist
 * On mock MongoDB pour tester la logique pure sans base de données
 */

jest.mock('../../src/models/Domain');
const Domain  = require('../../src/models/Domain');
const { analyze, detectTypo, extractParentDomains } = require('../../src/modules/blacklist');

// ── Tests de la détection de fautes de frappe ─────────────────────────────
describe('detectTypo()', () => {
  test('détecte gmial.com comme faute de gmail.com', () => {
    expect(detectTypo('gmial.com')).toBe('gmail.com');
  });

  test('détecte hotmial.com comme faute de hotmail.com', () => {
    expect(detectTypo('hotmial.com')).toBe('hotmail.com');
  });

  test('retourne null pour un domaine sans faute', () => {
    expect(detectTypo('gmail.com')).toBeNull();
  });

  test('retourne null pour un domaine inconnu', () => {
    expect(detectTypo('example.com')).toBeNull();
  });
});

// ── Tests de l'extraction des sous-domaines ───────────────────────────────
describe('extractParentDomains()', () => {
  test('extrait le domaine parent d\'un sous-domaine', () => {
    expect(extractParentDomains('mail.guerrillamail.com')).toEqual(['guerrillamail.com']);
  });

  test('retourne tableau vide pour un domaine simple', () => {
    expect(extractParentDomains('gmail.com')).toEqual([]);
  });
});

// ── Tests de la fonction analyze() ───────────────────────────────────────
describe('analyze()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retourne score=50 et flagged=true pour un domaine blacklisté', async () => {
    // Mock : MongoDB trouve le domaine dans la blacklist
    Domain.findOne.mockResolvedValue({ domain: 'mailinator.com', source: 'github' });

    const result = await analyze('user@mailinator.com', 'mailinator.com');

    expect(result.flagged).toBe(true);
    expect(result.score).toBe(50);
    expect(result.reasons).toHaveLength(1);
  });

  test('retourne score=0 et flagged=false pour un domaine propre', async () => {
    // Mock : MongoDB ne trouve rien
    Domain.findOne.mockResolvedValue(null);

    const result = await analyze('user@gmail.com', 'gmail.com');

    expect(result.flagged).toBe(false);
    expect(result.score).toBe(0);
  });

  test('retourne score=25 pour un email de rôle (admin@)', async () => {
    Domain.findOne.mockResolvedValue(null);

    const result = await analyze('admin@example.com', 'example.com');

    expect(result.score).toBe(25);
    expect(result.reasons[0]).toContain('rôle');
  });

  test('retourne score=30 pour une faute de frappe (gmial.com)', async () => {
    Domain.findOne.mockResolvedValue(null);

    const result = await analyze('user@gmial.com', 'gmial.com');

    expect(result.score).toBe(30);
    expect(result.reasons[0]).toContain('Faute de frappe');
  });

  test('le score maximal (50) prime sur les autres vérifications', async () => {
    // Domaine blacklisté ET email de rôle → score = 50 (pas 25)
    Domain.findOne.mockResolvedValue({ domain: 'mailinator.com', source: 'github' });

    const result = await analyze('admin@mailinator.com', 'mailinator.com');

    expect(result.score).toBe(50);
    expect(result.flagged).toBe(true);
  });
});

// ── Domaines jetables connus, dont plusieurs services Temp-Mail ──────────
// Vérifie que dès que MongoDB confirme le domaine, la blacklist le détecte
// systématiquement au score maximal — indépendamment de toute prédiction ML.
describe('analyze() — domaines jetables connus (incl. Temp-Mail)', () => {
  beforeEach(() => jest.clearAllMocks());

  const KNOWN_DISPOSABLE_DOMAINS = [
    'mailinator.com',
    'yopmail.com',
    'guerrillamail.com',
    'sharklasers.com',
    '10minutemail.com',
    'temp-mail.org',      // domaine principal du service Temp-Mail
    'jobraux.com',        // domaine de rotation observé chez Temp-Mail (dataset local)
  ];

  test.each(KNOWN_DISPOSABLE_DOMAINS)('%s est détecté par la blacklist (score=50, flagged=true)', async (domain) => {
    Domain.findOne.mockResolvedValue({ domain, source: 'local-dataset' });

    const result = await analyze(`user123@${domain}`, domain);

    expect(result.flagged).toBe(true);
    expect(result.score).toBe(50);
    expect(result.reasons[0]).toContain('Domaine jetable connu');
  });

  test('un domaine jetable connu reste détecté même sans signal local-part suspect', async () => {
    // "contact" est un prefixe de role ET le domaine est blacklisté :
    // le score doit rester à 50 (le max), pas la somme des deux signaux.
    Domain.findOne.mockResolvedValue({ domain: 'jobraux.com', source: 'local-dataset' });

    const result = await analyze('contact@jobraux.com', 'jobraux.com');

    expect(result.flagged).toBe(true);
    expect(result.score).toBe(50);
  });
});
