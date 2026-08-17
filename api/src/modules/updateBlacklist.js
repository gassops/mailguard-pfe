const axios  = require('axios');
const cron   = require('node-cron');
const Domain = require('../models/Domain');

const GITHUB_URL = process.env.BLACKLIST_GITHUB_URL ||
  'https://github.com/disposable-email-domains/disposable-email-domains';

/**
 * Télécharge la liste depuis GitHub et synchronise avec MongoDB
 * Utilise upsert pour ne pas créer de doublons
 */
async function updateBlacklist() {
  console.log('[Blacklist] Démarrage de la mise à jour...');
  const start = Date.now();

  try {
    const { data } = await axios.get(GITHUB_URL, { timeout: 30000 });

    // Nettoyage : supprimer lignes vides et commentaires
    const domains = data
      .split('\n')
      .map(d => d.trim().toLowerCase())
      .filter(d => d && !d.startsWith('//') && !d.startsWith('#'));

    let added   = 0;
    let updated = 0;

    // Traitement par batch de 500 pour éviter de surcharger MongoDB
    const BATCH_SIZE = 500;
    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE);

      const ops = batch.map(domain => ({
        updateOne: {
          filter: { domain },
          update: {
            $set:         { isDisposable: true, source: 'github', updatedAt: new Date() },
            $setOnInsert: { domain, active: true, reportCount: 0, addedAt: new Date() },
          },
          upsert: true,
        },
      }));

      const result = await Domain.bulkWrite(ops);
      added   += result.upsertedCount;
      updated += result.modifiedCount;
    }

    const duration = Date.now() - start;
    console.log(`[Blacklist] Terminé en ${duration}ms — ${added} ajoutés, ${updated} mis à jour`);
    return { added, updated, total: domains.length };

  } catch (err) {
    console.error('[Blacklist] Erreur de mise à jour :', err.message);
    throw err;
  }
}

/**
 * Planifie le cron hebdomadaire (dimanche à minuit par défaut)
 */
function startCron() {
  const schedule = process.env.BLACKLIST_UPDATE_CRON || '0 0 * * 0';
  cron.schedule(schedule, updateBlacklist);
  console.log(`[Blacklist] Cron planifié : ${schedule}`);
}

module.exports = { updateBlacklist, startCron };
