const Domain = require('../models/Domain');

// Fallback minimal identique à _DISPOSABLE_FALLBACK dans train.py
// Utilisé uniquement si MongoDB n'a pas encore été alimenté par importDomains.js
const FALLBACK_DISPOSABLE = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','yopmail.com',
  'trashmail.com','fakeinbox.com','mailnull.com','spamgourmet.com',
  'dispostable.com','maildrop.cc','sharklasers.com','grr.la',
  'spam4.me','getairmail.com','filzmail.com','tempr.email',
  'discard.email','10minutemail.com','10minutemail.net',
  'throwam.com','guerrillamail.info','guerrillamailblock.com',
  'ahem.email','anonymbox.com','antispam.de','binkmail.com',
  'bspamfree.org','bugmenot.com','dayrep.com','deadaddress.com',
  'deadletter.ga','devnullmail.com','dingbone.com','dfgh.net',
  'tempemail.net','tempinbox.com','temp-mail.org',
  'emailondeck.com','spambox.us','trashmail.at','trashmail.io',
  'getnada.com','burnermail.io','spamfree.eu',
  'mail-temporaire.fr','jetable.fr.nf','jetable.net','jetable.org',
  'mailzilla.com','mailnew.com','mailmoat.com','mail4trash.com',
]);

// Préfixes d'emails de rôle — ne correspondent pas à une personne réelle
const ROLE_PREFIXES = [
  'admin', 'noreply', 'no-reply', 'info', 'support',
  'test', 'contact', 'help', 'postmaster', 'webmaster',
  'sales', 'abuse', 'root', 'mail', 'security',
];

// Fautes de frappe connues sur les domaines populaires
const TYPO_MAP = {
  'gmail.com':   ['gmial.com', 'gmal.com', 'gamil.com', 'gnail.com', 'gmail.co'],
  'yahoo.com':   ['yahooo.com', 'yaho.com', 'yhoo.com', 'yahoo.co'],
  'hotmail.com': ['hotmial.com', 'hotmal.com', 'hotmail.co', 'homail.com'],
  'outlook.com': ['outlok.com', 'outloook.com', 'outlookk.com'],
};

/**
 * Analyse le domaine contre la blacklist intégrée + MongoDB
 * @param {string} email - adresse email complète
 * @param {string} domain - domaine extrait de l'email
 * @returns {{ flagged: boolean, score: number, reasons: string[] }}
 */
async function analyze(email, domain) {
  let score   = 0;
  let flagged = false;
  const reasons = [];

  const domainsToCheck = [domain, ...extractParentDomains(domain)];

  // ── Vérification 1 : blacklist MongoDB (source principale — datasets GitHub) ─
  try {
    const record = await Domain.findOne({
      domain:       { $in: domainsToCheck },
      isDisposable: true,
      active:       true,
    });

    if (record) {
      score   = 50;
      flagged = true;
      reasons.push(`Domaine jetable connu (source: ${record.source})`);
    }
  } catch (_) { /* MongoDB indisponible — on passe au fallback */ }

  // ── Vérification 1b : fallback minimal si MongoDB vide ou indisponible ───
  if (!flagged) {
    const fallbackHit = domainsToCheck.find(d => FALLBACK_DISPOSABLE.has(d));
    if (fallbackHit) {
      score   = 50;
      flagged = true;
      reasons.push(`Domaine jetable connu (fallback: ${fallbackHit})`);
    }
  }

  // ── Vérification 2 : email de rôle ───────────────────────────────────────
  const localPart = email.split('@')[0].toLowerCase();
  if (ROLE_PREFIXES.includes(localPart)) {
    score = Math.max(score, 25);
    reasons.push('Email de rôle non personnel (ex: admin@, noreply@)');
  }

  // ── Vérification 3 : faute de frappe ─────────────────────────────────────
  const correctDomain = detectTypo(domain);
  if (correctDomain) {
    score = Math.max(score, 30);
    reasons.push(`Faute de frappe probable : "${domain}" ressemble à "${correctDomain}"`);
  }

  // ── Vérification 4 : partie locale aléatoire (pattern tempmail) ──────────
  const entropyScore = detectRandomLocalPart(localPart);
  if (entropyScore > 0) {
    score = Math.max(score, entropyScore);
    reasons.push(`Partie locale suspecte : pattern aléatoire détecté ("${localPart}")`);
  }

  return { flagged, score, reasons };
}

/**
 * Extrait les domaines parents
 * mail.guerrillamail.com → ['guerrillamail.com']
 */
function extractParentDomains(domain) {
  const parts = domain.split('.');
  if (parts.length <= 2) return [];
  return [parts.slice(-2).join('.')];
}

/**
 * Retourne le domaine correct si une faute de frappe est détectée
 */
function detectTypo(domain) {
  for (const [correct, typos] of Object.entries(TYPO_MAP)) {
    if (typos.includes(domain.toLowerCase())) return correct;
  }
  return null;
}

/**
 * Détecte les parties locales générées aléatoirement (pattern tempmail).
 * Exemples : dagex92399, xeritaw888, abc123xyz, qwerty4567
 *
 * Critères :
 *   - longueur ≥ 8 caractères
 *   - contient lettres ET chiffres
 *   - suffixe numérique long OU entropie élevée
 *   - ne ressemble pas à prenom.nom ou prenom_nom123
 *
 * Retourne un score partiel (0, 20 ou 35) selon la confiance.
 */
function detectRandomLocalPart(local) {
  if (local.length < 8) return 0;

  const hasLetters = /[a-z]/.test(local);
  const hasDigits  = /[0-9]/.test(local);
  if (!hasLetters || !hasDigits) return 0;

  // Rejeter les patterns légitimes courants : prenom.nom, prenom_nom
  if (/^[a-z]+[._-][a-z]+\d*$/.test(local) && local.length <= 14) return 0;

  const digitRatio    = (local.match(/[0-9]/g) || []).length / local.length;
  const trailingDigits = (local.match(/\d+$/) || [''])[0].length;
  const entropy        = shannonEntropy(local);

  // Fort signal : suffixe ≥ 4 chiffres + ratio élevé (dagex92399 → trailing=5, ratio=0.50)
  if (trailingDigits >= 4 && digitRatio >= 0.25) return 35;

  // Fort signal : chiffres répétés à la fin (xeritaw888 → 888) + entropie suffisante
  if (trailingDigits >= 2 && /(\d)\1{1,}$/.test(local) && digitRatio >= 0.20) return 35;

  // Signal modéré : entropie élevée avec présence notable de chiffres
  if (entropy >= 2.8 && digitRatio >= 0.20) return 20;

  return 0;
}

function shannonEntropy(str) {
  const freq = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  return Object.values(freq).reduce((acc, n) => {
    const p = n / str.length;
    return acc - p * Math.log2(p);
  }, 0);
}

module.exports = { analyze, detectTypo, extractParentDomains, detectRandomLocalPart, ROLE_PREFIXES };
