/**
 * Import des domaines jetables depuis les datasets GitHub + fichiers locaux vers MongoDB.
 *
 * Sources GitHub :
 *   1. Inbox-Master/disposable-email-domains (format PHP array)
 *   2. c-dome/temporary-email (format plaintext, une ligne par domaine)
 *   3. disposable-email-domains/disposable-email-domains (format plaintext)
 *
 * Sources locales :
 *   Tous les fichiers .txt non vides dans ml-service/datasets/ (un domaine par ligne).
 *   Permet d'enrichir la blacklist avec des datasets fournis manuellement,
 *   sans dépendre de la disponibilité réseau des dépôts GitHub au moment de l'import.
 *
 * Usage :
 *   node scripts/importDomains.js            # import complet
 *   node scripts/importDomains.js --force    # force même si collection non vide
 */
require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');
const axios    = require('axios');
const Domain   = require('../src/models/Domain');

// Deux emplacements possibles selon le contexte d'execution :
//   - image buildee (api/Dockerfile copie ml-service/datasets -> ./datasets,
//     sibling de scripts/) ou docker-compose (bind-mount equivalent)
//   - repo local, script lance directement depuis api/ hors conteneur
const LOCAL_DATASETS_CANDIDATES = [
  path.join(__dirname, '../datasets'),
  path.join(__dirname, '../../ml-service/datasets'),
];
const LOCAL_DATASETS_DIR =
  LOCAL_DATASETS_CANDIDATES.find(p => fs.existsSync(p)) || LOCAL_DATASETS_CANDIDATES[0];

const SOURCES = [
  {
    name: 'inbox-master/disposable-email-domains',
    url:  'https://raw.githubusercontent.com/Inbox-Master/disposable-email-domains/master/config/domains.php',
    parse: parsePHP,
  },
  {
    name: 'c-dome/temporary-email',
    url:  'https://raw.githubusercontent.com/c-dome/temporary-email/main/list.txt',
    parse: parsePlaintext,
  },
  {
    name: 'disposable-email-domains/disposable-email-domains',
    url:  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf',
    parse: parsePlaintext,
  },
];

// ─── Parseurs ────────────────────────────────────────────────────────────────

function parsePHP(content) {
  const matches = content.match(/'([a-z0-9.\-]+\.[a-z]{2,})'/gi) || [];
  return matches
    .map(m => m.replace(/'/g, '').toLowerCase().trim())
    .filter(d => d.includes('.') && d.length > 3);
}

function parsePlaintext(content) {
  return content
    .split('\n')
    .map(l => l.trim().toLowerCase())
    .filter(l => l && !l.startsWith('#') && l.includes('.') && l.length > 3);
}

/**
 * Charge les domaines depuis les fichiers .txt locaux de ml-service/datasets/.
 * Chaque fichier vide (dataset non fourni) est simplement ignoré.
 *
 * @returns {{ name: string, domains: string[] }[]}
 */
function loadLocalDatasets() {
  if (!fs.existsSync(LOCAL_DATASETS_DIR)) return [];

  return fs.readdirSync(LOCAL_DATASETS_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(file => {
      const content = fs.readFileSync(path.join(LOCAL_DATASETS_DIR, file), 'utf-8');
      return { name: `local/${file}`, domains: parsePlaintext(content) };
    })
    .filter(({ domains }) => domains.length > 0);
}

// ─── Import principal ─────────────────────────────────────────────────────────

async function importDomains({ force = false } = {}) {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mailguard';
  const alreadyConnected = mongoose.connection.readyState === 1;

  if (!alreadyConnected) {
    await mongoose.connect(MONGO_URI);
    console.log('[importDomains] MongoDB connecté');
  }

  if (!force) {
    const count = await Domain.countDocuments({ isDisposable: true, active: true });
    if (count > 0) {
      console.log(`[importDomains] ${count} domaines déjà en base — skip (--force pour réimporter)`);
      if (!alreadyConnected) await mongoose.disconnect();
      return { skipped: true, count };
    }
  }

  const domainSources = new Map(); // domain -> nom de la source qui l'a fourni en premier

  for (const source of SOURCES) {
    console.log(`[importDomains] Téléchargement : ${source.name}`);
    try {
      const { data } = await axios.get(source.url, { timeout: 30_000, responseType: 'text' });
      const domains  = source.parse(data);
      console.log(`[importDomains]   → ${domains.length} domaines parsés`);
      domains.forEach(d => { if (!domainSources.has(d)) domainSources.set(d, 'github'); });
    } catch (err) {
      console.warn(`[importDomains]   ✗ Échec (${source.name}) : ${err.message}`);
    }
  }

  for (const { name, domains } of loadLocalDatasets()) {
    console.log(`[importDomains] Fichier local : ${name} → ${domains.length} domaines parsés`);
    domains.forEach(d => { if (!domainSources.has(d)) domainSources.set(d, 'local-dataset'); });
  }

  const allDomains = new Set(domainSources.keys());

  if (allDomains.size === 0) {
    console.error('[importDomains] Aucun domaine récupéré — vérifier la connectivité réseau');
    if (!alreadyConnected) await mongoose.disconnect();
    return { inserted: 0, error: 'no_data' };
  }

  console.log(`[importDomains] Total unique : ${allDomains.size} domaines — insertion en cours...`);

  const BATCH = 500;
  const list  = Array.from(allDomains);
  let inserted = 0;

  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const ops   = batch.map(domain => ({
      updateOne: {
        filter: { domain },
        update: { $setOnInsert: { domain, isDisposable: true, source: domainSources.get(domain), active: true, addedAt: new Date() } },
        upsert: true,
      },
    }));
    const result = await Domain.bulkWrite(ops, { ordered: false });
    inserted += result.upsertedCount;

    if ((i / BATCH) % 10 === 0) {
      console.log(`[importDomains]   ${Math.min(i + BATCH, list.length)}/${list.length} traités...`);
    }
  }

  console.log(`[importDomains] Import terminé : ${inserted} nouveaux domaines insérés (${allDomains.size - inserted} déjà existants)`);

  if (!alreadyConnected) await mongoose.disconnect();
  return { inserted, total: allDomains.size };
}

// ─── Point d'entrée CLI ───────────────────────────────────────────────────────

if (require.main === module) {
  const force = process.argv.includes('--force');
  importDomains({ force })
    .then(result => {
      if (result.skipped) process.exit(0);
      console.log(`\n[importDomains] Résultat : ${JSON.stringify(result)}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[importDomains] Erreur fatale :', err);
      process.exit(1);
    });
}

module.exports = { importDomains };
