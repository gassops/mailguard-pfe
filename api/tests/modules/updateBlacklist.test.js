/**
 * Tests unitaires — updateBlacklist (synchronisation de la blacklist)
 * axios, node-cron, le modèle Domain et Redis sont mockés : aucun réseau, aucune base.
 */

jest.mock('axios');
jest.mock('node-cron');
jest.mock('../../src/models/Domain');
jest.mock('../../src/utils/redis', () => ({ getRedis: jest.fn() }));

const axios  = require('axios');
const cron   = require('node-cron');
const Domain = require('../../src/models/Domain');
const { getRedis } = require('../../src/utils/redis');
const { parseList, updateBlacklist, startCron } = require('../../src/modules/updateBlacklist');

// Liste factice de n domaines valides (au-dessus du seuil de vraisemblance de 1000)
const fakeList = (n, extra = '') =>
  Array.from({ length: n }, (_, i) => `jetable${i}.example`).join('\n') + '\n' + extra;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BLACKLIST_UPDATE_CRON;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parseList()', () => {
  test('ignore commentaires, lignes vides et valeurs qui ne sont pas des domaines', () => {
    const text = '# commentaire\n\nMailinator.COM\n  yopmail.com \nnot a domain\nlocalhost\n<html>\n';
    expect(parseList(text)).toEqual(['mailinator.com', 'yopmail.com']);
  });

  test('normalise en minuscules, dédoublonne et gère les fins de ligne Windows', () => {
    expect(parseList('A.com\r\na.COM\r\nb.org\r\n')).toEqual(['a.com', 'b.org']);
  });
});

describe('updateBlacklist()', () => {
  test('insère par lots de 500 sans jamais modifier une entrée existante ($setOnInsert seul)', async () => {
    axios.get.mockResolvedValue({ data: fakeList(1200) });
    Domain.bulkWrite
      .mockResolvedValueOnce({ upsertedCount: 500 })
      .mockResolvedValueOnce({ upsertedCount: 500 })
      .mockResolvedValueOnce({ upsertedCount: 100 });

    const result = await updateBlacklist();

    expect(result).toEqual({ total: 1200, added: 1100 });
    expect(Domain.bulkWrite).toHaveBeenCalledTimes(3);
    const ops = Domain.bulkWrite.mock.calls.flatMap(([batch]) => batch);
    expect(ops).toHaveLength(1200);
    for (const { updateOne } of ops) {
      expect(updateOne.upsert).toBe(true);
      expect(updateOne.update.$set).toBeUndefined();          // ne réécrit pas une correction communautaire
      expect(updateOne.update.$setOnInsert).toMatchObject({ isDisposable: true, source: 'github', active: true });
    }
  });

  test('ne propose jamais un fournisseur grand public, même présent dans la liste amont', async () => {
    axios.get.mockResolvedValue({ data: fakeList(1200, 'gmail.com\noutlook.com\n') });
    Domain.bulkWrite.mockResolvedValue({ upsertedCount: 0 });

    await updateBlacklist();

    const domains = Domain.bulkWrite.mock.calls.flatMap(([batch]) => batch).map(o => o.updateOne.filter.domain);
    expect(domains).not.toContain('gmail.com');
    expect(domains).not.toContain('outlook.com');
    expect(domains).toHaveLength(1200);
  });

  test('refuse une liste suspecte (page d\'erreur, téléchargement tronqué) sans rien écrire', async () => {
    axios.get.mockResolvedValue({ data: '<html><body>404: Not Found</body></html>' });

    await expect(updateBlacklist()).rejects.toThrow(/liste suspecte/);
    expect(Domain.bulkWrite).not.toHaveBeenCalled();
  });

  test('propage l\'erreur réseau (le cron la journalise, l\'API n\'est pas affectée)', async () => {
    axios.get.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(updateBlacklist()).rejects.toThrow('ETIMEDOUT');
    expect(Domain.bulkWrite).not.toHaveBeenCalled();
  });
});

describe('startCron()', () => {
  const runScheduledJob = async () => {
    startCron();
    const job = cron.schedule.mock.calls[0][1];
    await job();
  };

  test('planifie par défaut le dimanche à minuit et respecte BLACKLIST_UPDATE_CRON', () => {
    startCron();
    expect(cron.schedule).toHaveBeenCalledWith('0 0 * * 0', expect.any(Function));

    cron.schedule.mockClear();
    process.env.BLACKLIST_UPDATE_CRON = '30 3 * * 1';
    startCron();
    expect(cron.schedule).toHaveBeenCalledWith('30 3 * * 1', expect.any(Function));
  });

  test('le réplica qui obtient le verrou Redis exécute la synchronisation', async () => {
    getRedis.mockReturnValue({ set: jest.fn().mockResolvedValue('OK') });
    axios.get.mockResolvedValue({ data: fakeList(1200) });
    Domain.bulkWrite.mockResolvedValue({ upsertedCount: 0 });

    await runScheduledJob();

    expect(getRedis().set).toHaveBeenCalledWith('blacklist:update:lock', expect.any(String), 'EX', 3600, 'NX');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('un réplica qui n\'obtient pas le verrou ne fait rien', async () => {
    getRedis.mockReturnValue({ set: jest.fn().mockResolvedValue(null) });

    await runScheduledJob();

    expect(axios.get).not.toHaveBeenCalled();
  });

  test('si Redis est indisponible, la synchronisation est sautée sans lever d\'exception', async () => {
    getRedis.mockImplementation(() => { throw new Error('Redis non initialisé'); });

    await expect(runScheduledJob()).resolves.toBeUndefined();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('une erreur de mise à jour est journalisée et ne remonte jamais', async () => {
    getRedis.mockReturnValue({ set: jest.fn().mockResolvedValue('OK') });
    axios.get.mockRejectedValue(new Error('ECONNRESET'));

    await expect(runScheduledJob()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
