/**
 * Tests unitaires — ScoreAggregator
 * Vérifie la pondération, les seuils de verdict et les cas spéciaux crowdsource.
 * Aucun mock nécessaire — la logique est pure (pas de DB / réseau).
 */

const {
  aggregate,
  computeWeightedScore,
  getVerdict,
  WEIGHTS,
  DEFAULT_THRESHOLDS,
} = require('../../src/services/scoreAggregator');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES — résultats de modules réutilisables dans les tests
// ─────────────────────────────────────────────────────────────────────────────

const MODULES_CLEAN = {
  blacklist:   { score: 0,  flagged: false, reasons: [] },
  mx:          { score: 0,  valid: true,    reasons: [] },
  smtp:        { score: 0,  exists: true,   reasons: [] },
  domainAge:   { score: 0,  riskLevel: 'LOW', days: 2000, reasons: [] },
  ml:          { score: 0,  probability: 0.02, is_disposable: false, reasons: [] },
  crowdsource: { score: 0,  correction: null, reports: 0, reasons: [] },
};

const MODULES_JETABLE = {
  blacklist:   { score: 50, flagged: true,  reasons: ['Domaine jetable connu'] },
  mx:          { score: 0,  valid: true,    reasons: [] },
  smtp:        { score: 0,  exists: true,   reasons: [] },
  domainAge:   { score: 10, riskLevel: 'VERY_HIGH', days: 5, reasons: ['Domaine tres recent'] },
  ml:          { score: 14, probability: 0.93, is_disposable: true, reasons: ['Suspect ML (93%)'] },
  crowdsource: { score: 0,  correction: null, reports: 0, reasons: [] },
};

// ─────────────────────────────────────────────────────────────────────────────
// computeWeightedScore()
// ─────────────────────────────────────────────────────────────────────────────

describe('computeWeightedScore()', () => {

  test('retourne 0 si tous les modules sont à score 0', () => {
    expect(computeWeightedScore(MODULES_CLEAN)).toBe(0);
  });

  test('retourne 100 si tous les modules sont à leur score maximum', () => {
    const allMax = {
      blacklist:   { score: 50 },
      mx:          { score: 20 },
      smtp:        { score: 15 },
      domainAge:   { score: 10 },
      ml:          { score: 15 },
      crowdsource: { score: 50 },
    };
    expect(computeWeightedScore(allMax)).toBe(100);
  });

  test('la blacklist (poids 0.55) contribue le plus au score', () => {
    const blacklistOnly = {
      ...MODULES_CLEAN,
      blacklist: { score: 50 },
    };
    const mlOnly = {
      ...MODULES_CLEAN,
      ml: { score: 15 },
    };
    expect(computeWeightedScore(blacklistOnly)).toBeGreaterThan(computeWeightedScore(mlOnly));
  });

  test('un module absent (undefined) compte pour 0 sans planter', () => {
    const partial = { blacklist: { score: 50 } };
    expect(() => computeWeightedScore(partial)).not.toThrow();
  });

  test('un score supérieur au max déclaré est plafonné', () => {
    const overMax = { ...MODULES_CLEAN, blacklist: { score: 999 } };
    expect(computeWeightedScore(overMax)).toBeLessThanOrEqual(100);
  });

  test('calcule correctement un cas réel — email jetable', () => {
    const score = computeWeightedScore(MODULES_JETABLE);
    // blacklist: 50/50*100*0.55 = 55
    // domainAge: 10/10*100*0.06 = 6
    // ml: 14/15*100*0.20 ≈ 18.7
    // total ≈ 79.7
    expect(score).toBeGreaterThanOrEqual(75);
    expect(score).toBeLessThanOrEqual(85);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// getVerdict()
// ─────────────────────────────────────────────────────────────────────────────

describe('getVerdict()', () => {

  test('score 0 → VALID', () => {
    expect(getVerdict(0, null)).toBe('VALID');
  });

  test('score 20 → VALID (seuil suspicious = 21)', () => {
    expect(getVerdict(20, null)).toBe('VALID');
  });

  test('score 21 → SUSPICIOUS (seuil exact)', () => {
    expect(getVerdict(21, null)).toBe('SUSPICIOUS');
  });

  test('score 50 → SUSPICIOUS', () => {
    expect(getVerdict(50, null)).toBe('SUSPICIOUS');
  });

  test('score 51 → INVALID (seuil exact)', () => {
    expect(getVerdict(51, null)).toBe('INVALID');
  });

  test('score 100 → INVALID', () => {
    expect(getVerdict(100, null)).toBe('INVALID');
  });

  test('FORCE_INVALID force le verdict INVALID même avec score 0', () => {
    expect(getVerdict(0, 'FORCE_INVALID')).toBe('INVALID');
  });

  test('FORCE_VALID force le verdict VALID même avec score 100', () => {
    expect(getVerdict(100, 'FORCE_VALID')).toBe('VALID');
  });

  test('respecte les seuils personnalisés du client', () => {
    const custom = { suspicious: 30, invalid: 70 };
    expect(getVerdict(25, null, custom)).toBe('VALID');
    expect(getVerdict(30, null, custom)).toBe('SUSPICIOUS');
    expect(getVerdict(70, null, custom)).toBe('INVALID');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// aggregate()
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregate()', () => {

  test('email légitime → score bas, verdict VALID', () => {
    const result = aggregate(MODULES_CLEAN);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('VALID');
  });

  test('email jetable → score élevé, verdict INVALID', () => {
    const result = aggregate(MODULES_JETABLE);
    expect(result.score).toBeGreaterThan(50);
    expect(result.verdict).toBe('INVALID');
  });

  test('faux positif ML seul + domainAge neutre (WHOIS en échec) ne bascule jamais un domaine propre en SUSPICIOUS', () => {
    // Régression : à ml=0.20, un faux positif ML (probabilité proche de 1 sur
    // un domaine légitime — cas réel observé avec gmail.com) combiné au score
    // neutre de domainAge en cas d'échec WHOIS (5/10, pas 0) suffisait à
    // dépasser le seuil SUSPICIOUS (21). Ce test fige la marge de sécurité.
    const worstCase = {
      ...MODULES_CLEAN,
      domainAge: { score: 5, riskLevel: 'UNKNOWN', days: null, reasons: ['Requête WHOIS échouée'] },
      ml:        { score: 15, probability: 0.96, is_disposable: true, reasons: ['Suspect ML'] },
    };
    const result = aggregate(worstCase);
    expect(result.score).toBeLessThan(21);
    expect(result.verdict).toBe('VALID');
  });

  test('domaine blacklisté SEUL (autres modules propres) → INVALID', () => {
    // Le poids blacklist (0.55) doit à lui seul dépasser le seuil INVALID (51) :
    // un domaine jetable connu doit toujours être INVALID, peu importe MX/SMTP/ML/etc.
    const blacklistOnly = {
      ...MODULES_CLEAN,
      blacklist: { score: 50, flagged: true, reasons: ['Domaine jetable connu'] },
    };
    const result = aggregate(blacklistOnly);
    expect(result.score).toBeGreaterThanOrEqual(51);
    expect(result.verdict).toBe('INVALID');
  });

  test('retourne la structure attendue par la route /verify', () => {
    const result = aggregate(MODULES_CLEAN);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('reasons');
    expect(result).toHaveProperty('details');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  test('collecte toutes les reasons de tous les modules', () => {
    const result = aggregate(MODULES_JETABLE);
    expect(result.reasons).toContain('Domaine jetable connu');
    expect(result.reasons).toContain('Domaine tres recent');
    expect(result.reasons).toContain('Suspect ML (93%)');
  });

  test('FORCE_INVALID crowdsource écrase un score bas', () => {
    const withForce = {
      ...MODULES_CLEAN,
      crowdsource: { score: 50, correction: 'FORCE_INVALID', reports: 3, reasons: ['Forcé invalide'] },
    };
    const result = aggregate(withForce);
    expect(result.verdict).toBe('INVALID');
  });

  test('FORCE_VALID crowdsource écrase un score élevé', () => {
    const withForce = {
      ...MODULES_JETABLE,
      crowdsource: { score: 0, correction: 'FORCE_VALID', reports: 3, reasons: ['Faux positif validé'] },
    };
    const result = aggregate(withForce);
    expect(result.verdict).toBe('VALID');
  });

  test('details contient les champs clés de chaque module', () => {
    const result = aggregate(MODULES_JETABLE);
    expect(result.details.blacklist).toHaveProperty('flagged');
    expect(result.details.mx_check).toHaveProperty('valid');
    expect(result.details.smtp_check).toHaveProperty('exists');
    expect(result.details.domain_age).toHaveProperty('riskLevel');
    expect(result.details.ml_classifier).toHaveProperty('probability');
    expect(result.details.crowdsource).toHaveProperty('validated');
  });

  test('respecte les seuils personnalisés du client', () => {
    const custom = { suspicious: 5, invalid: 30 };
    const result = aggregate(MODULES_CLEAN, custom);
    expect(result.verdict).toBe('VALID');

    const withSmallScore = {
      ...MODULES_CLEAN,
      mx: { score: 20, valid: false, reasons: ['Pas de MX'] },
    };
    const result2 = aggregate(withSmallScore, custom);
    // mx: 20/20*100*0.10 = 10 → SUSPICIOUS avec seuil suspicious=5
    expect(result2.verdict).toBe('SUSPICIOUS');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHTS — vérification de la cohérence de la configuration
// ─────────────────────────────────────────────────────────────────────────────

describe('WEIGHTS — cohérence de la configuration', () => {

  test('la somme des poids est exactement 1.0', () => {
    const total = Object.values(WEIGHTS).reduce((sum, { weight }) => sum + weight, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  test('les 6 modules attendus sont tous définis', () => {
    const keys = Object.keys(WEIGHTS);
    expect(keys).toContain('blacklist');
    expect(keys).toContain('mx');
    expect(keys).toContain('smtp');
    expect(keys).toContain('domainAge');
    expect(keys).toContain('ml');
    expect(keys).toContain('crowdsource');
  });

  test('tous les max sont des nombres positifs', () => {
    Object.values(WEIGHTS).forEach(({ max }) => {
      expect(typeof max).toBe('number');
      expect(max).toBeGreaterThan(0);
    });
  });

});
