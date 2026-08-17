const whois = require('whois');

/**
 * Expressions régulières pour extraire la date de création depuis la réponse WHOIS.
 * Chaque registraire (Namecheap, GoDaddy, OVH, etc.) utilise un format légèrement différent,
 * donc on essaie plusieurs patterns dans l'ordre jusqu'à en trouver un qui fonctionne.
 */
const CREATION_DATE_PATTERNS = [
  /creation date:\s*(.+)/i,       // format standard ICANN (le plus courant)
  /created:\s*(.+)/i,             // format court utilisé par certains registraires européens
  /registered on:\s*(.+)/i,       // format Nominet (registraire .uk)
  /domain registered:\s*(.+)/i,   // format alternatif rare
  /registered:\s*(.+)/i,          // format générique de fallback
  /commencement date:\s*(.+)/i,   // format utilisé par certains registraires australiens
];

/**
 * Module 4 — Domain Age Check
 *
 * Logique : un domaine récemment créé est statistiquement plus suspect
 * (les services de mails jetables créent souvent des domaines à la volée).
 * On interroge le WHOIS pour récupérer la date de création, puis on calcule
 * l'âge en jours et on attribue un score de risque selon les seuils du CDC.
 *
 * Seuils définis dans le cahier des charges :
 *   > 2 ans  (730 j) → risque FAIBLE      → score 0
 *   6-24 mois (180-730 j) → risque MODÉRÉ → score 3
 *   1-6 mois  (30-180 j)  → risque ÉLEVÉ  → score 7
 *   < 1 mois  (0-30 j)    → risque TRÈS ÉLEVÉ → score 10
 *
 * @param {string} domain - domaine à analyser (ex: "example.com")
 * @returns {{ days: number|null, score: number, riskLevel: string, reasons: string[] }}
 */
async function analyze(domain) {
  try {
    // Interroger le serveur WHOIS correspondant au domaine
    const raw = await lookupWhois(domain);

    // Extraire la date de création depuis la réponse texte brute
    const creationDate = parseCreationDate(raw);

    // Si aucune date n'a pu être extraite, on retourne un score neutre
    // plutôt que de pénaliser injustement un domaine dont le WHOIS est opaque
    if (!creationDate) {
      return {
        days: null,
        score: 5,
        riskLevel: 'UNKNOWN',
        reasons: ['Date de création introuvable dans le WHOIS'],
      };
    }

    // Calcul de l'âge du domaine en jours entiers
    // 86400000 = nombre de millisecondes dans une journée (1000 * 60 * 60 * 24)
    const days = Math.floor((Date.now() - creationDate.getTime()) / 86400000);

    // Détermination du niveau de risque selon les seuils du CDC
    const { score, riskLevel } = getRiskLevel(days);

    // On n'ajoute une raison que si le score est non nul (domaine suspect)
    const reasons = score > 0
      ? [`Domaine créé il y a ${days} jours (risque ${riskLevel})`]
      : [];

    return { days, score, riskLevel, reasons };

  } catch (err) {
    // Erreur réseau ou timeout WHOIS — on ne pénalise pas, score neutre
    return {
      days: null,
      score: 5,
      riskLevel: 'UNKNOWN',
      reasons: [`Requête WHOIS échouée : ${err.message}`],
    };
  }
}

/**
 * Encapsule l'API callback du module `whois` dans une Promise
 * pour pouvoir utiliser async/await dans analyze().
 * Timeout fixé à 10 secondes pour ne pas bloquer le pipeline d'analyse.
 *
 * @param {string} domain
 * @returns {Promise<string>} - réponse WHOIS brute en texte
 */
function lookupWhois(domain) {
  return new Promise((resolve, reject) => {
    whois.lookup(domain, { timeout: 10000 }, (err, data) => {
      if (err) return reject(err);
      resolve(data || '');
    });
  });
}

/**
 * Tente d'extraire la date de création depuis la réponse WHOIS brute.
 * Parcourt les patterns dans l'ordre et retourne la première date valide trouvée.
 *
 * @param {string} raw - réponse WHOIS complète en texte
 * @returns {Date|null} - date de création ou null si non trouvée / invalide
 */
function parseCreationDate(raw) {
  for (const pattern of CREATION_DATE_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      // new Date() accepte les formats ISO 8601, RFC 2822, et certains formats locaux
      const date = new Date(match[1].trim());
      // isNaN détecte les dates invalides comme "Invalid Date"
      if (!isNaN(date.getTime())) return date;
    }
  }
  return null;
}

/**
 * Convertit un âge en jours en niveau de risque et score partiel.
 * Les seuils correspondent exactement à ceux définis dans le CDC (section 6.4).
 *
 * @param {number} days - âge du domaine en jours
 * @returns {{ score: number, riskLevel: string }}
 */
function getRiskLevel(days) {
  if (days > 730) return { score: 0,  riskLevel: 'LOW' };       // > 2 ans
  if (days > 180) return { score: 3,  riskLevel: 'MODERATE' };  // 6 mois – 2 ans
  if (days > 30)  return { score: 7,  riskLevel: 'HIGH' };      // 1 – 6 mois
  return              { score: 10, riskLevel: 'VERY_HIGH' };     // < 1 mois
}

module.exports = { analyze, parseCreationDate, getRiskLevel };
