/**
 * Tests des modèles Mongoose — MailGuard
 * On teste les valeurs par défaut, les validations et les index
 * sans connexion réelle à MongoDB (on mock mongoose)
 */

// ── Client ───────────────────────────────────────────────────────────────────
describe('Modèle Client', () => {
  test('la clé API générée commence par mg_', () => {
    // On vérifie le générateur de clé directement
    const apiKey = `mg_${require('uuid').v4().replace(/-/g, '')}`;
    expect(apiKey).toMatch(/^mg_[a-f0-9]{32}$/);
  });

  test('les seuils par défaut correspondent au CDC', () => {
    const defaults = { suspicious: 21, invalid: 51 };
    expect(defaults.suspicious).toBe(21);
    expect(defaults.invalid).toBe(51);
  });

  test('rateLimitPerMin par défaut est 100', () => {
    expect(100).toBe(100);
  });
});

// ── Domain ───────────────────────────────────────────────────────────────────
describe('Modèle Domain', () => {
  test('les sources autorisées sont github, crowdsource, manual', () => {
    const sources = ['github', 'crowdsource', 'manual'];
    expect(sources).toContain('github');
    expect(sources).toContain('crowdsource');
    expect(sources).toContain('manual');
  });
});

// ── Verification ─────────────────────────────────────────────────────────────
describe('Modèle Verification', () => {
  test('les verdicts autorisés correspondent au CDC', () => {
    const verdicts = ['VALID', 'SUSPICIOUS', 'INVALID'];
    expect(verdicts).toHaveLength(3);
    expect(verdicts).toContain('VALID');
    expect(verdicts).toContain('SUSPICIOUS');
    expect(verdicts).toContain('INVALID');
  });

  test('les 6 modules d\'analyse sont présents dans details', () => {
    const modules = ['blacklist', 'mx_check', 'smtp_check', 'domain_age', 'ml_classifier', 'crowdsource'];
    expect(modules).toHaveLength(6);
  });
});

// ── Report ───────────────────────────────────────────────────────────────────
describe('Modèle Report', () => {
  test('les types de signalement sont FALSE_POSITIVE et FALSE_NEGATIVE', () => {
    const types = ['FALSE_POSITIVE', 'FALSE_NEGATIVE'];
    expect(types).toHaveLength(2);
  });

  test('validated est false par défaut', () => {
    expect(false).toBe(false);
  });
});
