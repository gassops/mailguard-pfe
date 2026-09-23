/**
 * Tests unitaires — cache Redis de la recherche blacklist (par domaine, TTL court).
 * Redis et le modèle Domain sont mockés : aucune base, aucun réseau.
 */
jest.mock('../../src/models/Domain');
jest.mock('../../src/utils/redis', () => ({ getRedis: jest.fn() }));

const Domain = require('../../src/models/Domain');
const { getRedis } = require('../../src/utils/redis');
const blacklist = require('../../src/modules/blacklist');

const dbReturns = (value) => Domain.findOne.mockReturnValue({ lean: () => Promise.resolve(value) });

beforeEach(() => jest.clearAllMocks());

describe('cache de la recherche blacklist', () => {
  test('hit : le résultat vient de Redis, MongoDB n\'est pas interrogé', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(JSON.stringify({ source: 'github' })), setex: jest.fn() });

    const r = await blacklist.analyze('x@spam-domain.example', 'spam-domain.example');

    expect(r.flagged).toBe(true);
    expect(Domain.findOne).not.toHaveBeenCalled();
  });

  test('absence mémorisée : une chaîne vide en cache signifie « pas dans la blacklist », sans requête MongoDB', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(''), setex: jest.fn() });

    const r = await blacklist.analyze('john@legit-company.example', 'legit-company.example');

    expect(r.flagged).toBe(false);
    expect(Domain.findOne).not.toHaveBeenCalled();
  });

  test('miss : interroge MongoDB puis mémorise le résultat (y compris l\'absence) avec un TTL court', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') };
    getRedis.mockReturnValue(redis);
    dbReturns({ source: 'crowdsource' });

    const hit = await blacklist.analyze('x@fresh-spam.example', 'fresh-spam.example');
    expect(hit.flagged).toBe(true);
    expect(redis.setex).toHaveBeenCalledWith('bl:fresh-spam.example', 300, JSON.stringify({ source: 'crowdsource' }));

    redis.setex.mockClear();
    dbReturns(null);
    const miss = await blacklist.analyze('john@another.example', 'another.example');
    expect(miss.flagged).toBe(false);
    expect(redis.setex).toHaveBeenCalledWith('bl:another.example', 300, '');
  });

  test('Redis en panne : la recherche retombe sur MongoDB sans erreur', async () => {
    getRedis.mockImplementation(() => { throw new Error('Redis non initialisé'); });
    dbReturns({ source: 'github' });

    const r = await blacklist.analyze('x@spam-domain.example', 'spam-domain.example');

    expect(r.flagged).toBe(true);
    expect(Domain.findOne).toHaveBeenCalledTimes(1);
  });
});
