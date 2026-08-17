/**
 * Tests unitaires — Module 6 : Crowdsourced Flagging
 * On mock MongoDB pour tester sans base de données
 */

jest.mock('../../src/models/Report');
jest.mock('../../src/models/Domain');

const Report = require('../../src/models/Report');
const Domain = require('../../src/models/Domain');
const { analyze, VALIDATION_THRESHOLD } = require('../../src/modules/crowdsource');

describe('analyze() — Crowdsourced Flagging', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retourne FORCE_INVALID si domaine déjà marqué jetable en base', async () => {
    Domain.findOne.mockResolvedValue({ domain: 'bad.com', isDisposable: true, source: 'crowdsource', reportCount: 5 });

    const result = await analyze('user@bad.com', 'bad.com');

    expect(result.correction).toBe('FORCE_INVALID');
    expect(result.score).toBe(50);
    expect(result.reports).toBe(5);
  });

  test('retourne FORCE_VALID si domaine marqué légitime en base', async () => {
    Domain.findOne.mockResolvedValue({ domain: 'good.com', isDisposable: false, source: 'crowdsource', reportCount: 4 });

    const result = await analyze('user@good.com', 'good.com');

    expect(result.correction).toBe('FORCE_VALID');
    expect(result.score).toBe(0);
  });

  test(`déclenche FORCE_INVALID quand FALSE_NEGATIVE >= ${VALIDATION_THRESHOLD}`, async () => {
    Domain.findOne.mockResolvedValue(null);
    Domain.findOneAndUpdate = jest.fn().mockResolvedValue({});
    Report.countDocuments
      .mockResolvedValueOnce(VALIDATION_THRESHOLD) // FALSE_NEGATIVE
      .mockResolvedValueOnce(0);                    // FALSE_POSITIVE

    const result = await analyze('user@spam.com', 'spam.com');

    expect(result.correction).toBe('FORCE_INVALID');
    expect(result.score).toBe(50);
  });

  test(`déclenche FORCE_VALID quand FALSE_POSITIVE >= ${VALIDATION_THRESHOLD}`, async () => {
    Domain.findOne.mockResolvedValue(null);
    Domain.findOneAndUpdate = jest.fn().mockResolvedValue({});
    Report.countDocuments
      .mockResolvedValueOnce(0)                     // FALSE_NEGATIVE
      .mockResolvedValueOnce(VALIDATION_THRESHOLD); // FALSE_POSITIVE

    const result = await analyze('user@legit.com', 'legit.com');

    expect(result.correction).toBe('FORCE_VALID');
    expect(result.score).toBe(0);
  });

  test('retourne score proportionnel si signalements insuffisants', async () => {
    Domain.findOne.mockResolvedValue(null);
    Report.countDocuments
      .mockResolvedValueOnce(1) // FALSE_NEGATIVE
      .mockResolvedValueOnce(0); // FALSE_POSITIVE

    const result = await analyze('user@maybe.com', 'maybe.com');

    expect(result.correction).toBeNull();
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(23);
  });

  test('retourne score=0 si aucun signalement', async () => {
    Domain.findOne.mockResolvedValue(null);
    Report.countDocuments.mockResolvedValue(0);

    const result = await analyze('user@clean.com', 'clean.com');

    expect(result.score).toBe(0);
    expect(result.correction).toBeNull();
    expect(result.reports).toBe(0);
  });
});
