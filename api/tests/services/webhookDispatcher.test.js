/**
 * Tests unitaires — webhookDispatcher
 * Mock MongoDB (Webhook) et axios pour tester le dispatch sans réseau réel.
 */

jest.mock('../../src/models/Webhook');
jest.mock('axios');
// Redis n'est pas initialisé dans ce test unitaire : getRedis() lève, le
// dispatcher retombe alors sur MongoDB — c'est exactement le chemin testé ici.
jest.mock('../../src/utils/redis', () => ({
  getRedis: () => { throw new Error('Redis non initialisé'); },
}));

const axios   = require('axios');
const Webhook = require('../../src/models/Webhook');
const { dispatch, sign } = require('../../src/services/webhookDispatcher');

describe('sign()', () => {
  test('produit une signature HMAC-SHA256 déterministe pour un même secret et payload', () => {
    const payload = { event: 'INVALID', domain: 'spam.com' };
    const s1 = sign('mon-secret', payload);
    const s2 = sign('mon-secret', payload);

    expect(s1).toBe(s2);
    expect(s1).toMatch(/^[0-9a-f]{64}$/); // hex SHA-256 = 64 caractères
  });

  test('produit une signature différente pour un secret différent', () => {
    const payload = { event: 'INVALID', domain: 'spam.com' };
    expect(sign('secret-a', payload)).not.toBe(sign('secret-b', payload));
  });
});

describe('dispatch()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ne fait rien si aucun webhook actif n\'est configuré pour ce client', async () => {
    Webhook.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    await dispatch('client-1', 'INVALID', { email: 'a@spam.com', domain: 'spam.com', score: 80, verdict: 'INVALID' });

    expect(axios.post).not.toHaveBeenCalled();
  });

  test('ne fait rien si le verdict n\'est pas dans les événements souscrits', async () => {
    Webhook.findOne.mockReturnValue({ lean: () => Promise.resolve({
      _id: 'wh-1', url: 'https://client.example/hook', events: ['INVALID'], secret: 'sekret',
    }) });

    await dispatch('client-1', 'VALID', { email: 'a@good.com', domain: 'good.com', score: 2, verdict: 'VALID' });

    expect(axios.post).not.toHaveBeenCalled();
  });

  test('POST le payload signé et met à jour lastTriggered quand le verdict correspond', async () => {
    Webhook.findOne.mockReturnValue({ lean: () => Promise.resolve({
      _id: 'wh-1', url: 'https://client.example/hook', events: ['INVALID'], secret: 'sekret',
    }) });
    Webhook.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    axios.post.mockResolvedValue({ status: 200 });

    const result = { email: 'a@spam.com', domain: 'spam.com', score: 80, verdict: 'INVALID' };
    await dispatch('client-1', 'INVALID', result);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://client.example/hook');
    expect(payload).toMatchObject({ event: 'INVALID', domain: 'spam.com', verdict: 'INVALID' });
    expect(config.headers['X-MailGuard-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    expect(Webhook.findByIdAndUpdate).toHaveBeenCalledWith('wh-1', expect.objectContaining({ lastTriggered: expect.any(Date) }));
  });

  test('ne lève jamais d\'exception même si la requête HTTP échoue (best-effort)', async () => {
    Webhook.findOne.mockReturnValue({ lean: () => Promise.resolve({
      _id: 'wh-1', url: 'https://client.example/hook', events: ['INVALID'], secret: 'sekret',
    }) });
    axios.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      dispatch('client-1', 'INVALID', { email: 'a@spam.com', domain: 'spam.com', score: 80, verdict: 'INVALID' })
    ).resolves.toBeUndefined();
  });
});
