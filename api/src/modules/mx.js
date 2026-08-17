const dns = require('dns').promises;

// Serveurs MX connus pour appartenir à des fournisseurs d'emails jetables
const BLACKLISTED_MX_SERVERS = [
  'mx.mailinator.com',
  'aspmx.guerrillamail.com',
  'mx.trashmail.com',
  'mail.spamgourmet.com',
];

/**
 * Module 2 — MX Record Validation
 * Vérifie que le domaine possède un enregistrement MX valide
 * @param {string} domain
 * @returns {{ valid: boolean, score: number, mx: string|null, reasons: string[] }}
 */
async function analyze(domain) {
  const reasons = [];

  try {
    const records = await dns.resolveMx(domain);

    if (!records || records.length === 0) {
      return { valid: false, score: 20, mx: null, reasons: ['Aucun enregistrement MX trouvé'] };
    }

    // Trier par priorité — le serveur principal a la valeur la plus basse
    const sorted = [...records].sort((a, b) => a.priority - b.priority);
    const primaryMx = sorted[0].exchange.toLowerCase().replace(/\.$/, '');

    const isBlacklisted = BLACKLISTED_MX_SERVERS.some(bad => primaryMx.includes(bad));
    if (isBlacklisted) {
      reasons.push(`Serveur MX associé à un service jetable : ${primaryMx}`);
      return { valid: false, score: 20, mx: primaryMx, reasons };
    }

    return { valid: true, score: 0, mx: primaryMx, reasons };

  } catch (err) {
    const hardErrors = ['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT', 'EREFUSED'];
    const score = hardErrors.includes(err.code) ? 20 : 10;
    reasons.push(`Résolution DNS échouée (${err.code || err.message})`);
    return { valid: false, score, mx: null, reasons };
  }
}

module.exports = { analyze, BLACKLISTED_MX_SERVERS };
