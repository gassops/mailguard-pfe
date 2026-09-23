const axios  = require('axios');
const cron   = require('node-cron');
const Domain = require('../models/Domain');
const { getRedis } = require('../utils/redis');

// Liste de référence tenue à jour par la communauté : un domaine par ligne, commentaires en « # ».
// URL « raw » : l'ancienne valeur par défaut pointait sur la page HTML du dépôt, dont chaque ligne
// aurait été importée comme un « domaine ».
const LIST_URL = process.env.BLACKLIST_LIST_URL ||
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf';

// En deçà de ce nombre de domaines valides, le téléchargement est réputé tronqué ou erroné
// (page d'erreur, liste vide) : on n'importe rien plutôt que d'importer n'importe quoi.
const MIN_EXPECTED_DOMAINS = 1000;

const BATCH_SIZE       = 500;
const LOCK_KEY         = 'blacklist:update:lock';
const LOCK_TTL_SECONDS = 3600;

// Fournisseurs grand public : jamais ajoutés par une synchronisation automatique, même si une
// liste amont les contenait par erreur (un seul faux positif ici bloquerait des millions d'adresses).
const PROTECTED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me',
  'gmx.com', 'orange.fr', 'free.fr', 'laposte.net', 'sfr.fr',
]);

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

/**
 * Extrait les domaines valides d'un texte « un domaine par ligne » : ignore les lignes vides, les
 * commentaires (#) et tout ce qui n'a pas la forme d'un nom de domaine, normalise en minuscules
 * et dédoublonne.
 *
 * @param {string} text
 * @returns {string[]}
 */
function parseList(text) {
  const domains = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith('#')) continue;
    if (DOMAIN_RE.test(line)) domains.add(line);
  }
  return [...domains];
}

/**
 * Télécharge la liste de référence et AJOUTE à MongoDB les domaines qu'il ne connaît pas encore.
 *
 * Insertion seule ($setOnInsert) : une entrée existante n'est jamais modifiée. C'est volontaire —
 * un domaine réhabilité (ou confirmé jetable) par les signalements de la communauté, ou ajouté à la
 * main, garde sa décision au lieu d'être écrasé par la liste amont à chaque synchronisation.
 *
 * @returns {Promise<{ total: number, added: number }>}
 */
async function updateBlacklist() {
  console.log('[Blacklist] Démarrage de la mise à jour...');
  const start = Date.now();

  const { data } = await axios.get(LIST_URL, { timeout: 30000, responseType: 'text' });
  const domains = parseList(String(data)).filter(d => !PROTECTED_DOMAINS.has(d));

  if (domains.length < MIN_EXPECTED_DOMAINS) {
    throw new Error(`liste suspecte (${domains.length} domaines valides, ${MIN_EXPECTED_DOMAINS} attendus au minimum) — mise à jour ignorée`);
  }

  let added = 0;
  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const ops = domains.slice(i, i + BATCH_SIZE).map(domain => ({
      updateOne: {
        filter: { domain },
        update: {
          $setOnInsert: {
            domain, isDisposable: true, source: 'github', active: true,
            reportCount: 0, addedAt: new Date(), updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
    const result = await Domain.bulkWrite(ops, { ordered: false });
    added += result.upsertedCount;
  }

  console.log(`[Blacklist] Terminé en ${Date.now() - start}ms — ${added} ajoutés sur ${domains.length} domaines de la liste`);
  return { total: domains.length, added };
}

/**
 * Verrou distribué : l'API tourne sur plusieurs réplicas qui déclencheraient tous la même tâche à la
 * même seconde. Le premier qui pose la clé exécute, les autres passent. Si Redis est indisponible on
 * ne déclenche pas (mieux vaut sauter une semaine que lancer N imports simultanés).
 */
async function acquireLock() {
  try {
    return (await getRedis().set(LOCK_KEY, String(process.pid), 'EX', LOCK_TTL_SECONDS, 'NX')) === 'OK';
  } catch (err) {
    console.warn('[Blacklist] Verrou indisponible (Redis) — synchronisation ignorée :', err.message);
    return false;
  }
}

/**
 * Planifie la synchronisation hebdomadaire (dimanche à minuit par défaut, modifiable par
 * BLACKLIST_UPDATE_CRON). N'interrompt jamais l'API : toute erreur est journalisée.
 */
function startCron() {
  const schedule = process.env.BLACKLIST_UPDATE_CRON || '0 0 * * 0';
  cron.schedule(schedule, async () => {
    if (!(await acquireLock())) {
      console.log('[Blacklist] Synchronisation déjà prise en charge par un autre réplica — ignorée');
      return;
    }
    try {
      await updateBlacklist();
    } catch (err) {
      console.error('[Blacklist] Erreur de mise à jour :', err.message);
    }
  });
  console.log(`[Blacklist] Synchronisation planifiée : ${schedule}`);
}

module.exports = { updateBlacklist, startCron, parseList, PROTECTED_DOMAINS, MIN_EXPECTED_DOMAINS };
