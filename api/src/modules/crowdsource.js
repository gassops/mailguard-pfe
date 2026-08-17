const Report = require('../models/Report');
const Domain = require('../models/Domain');

/**
 * Nombre minimum de signalements indépendants nécessaires pour déclencher
 * une correction automatique du verdict d'un domaine.
 * Défini à 3 dans le CDC (section 6.6) pour éviter les abus d'un seul client.
 */
const VALIDATION_THRESHOLD = 3;

/**
 * Module 6 — Crowdsourced Flagging (Signalements utilisateurs)
 *
 * Les clients de l'API peuvent signaler :
 *   - FALSE_NEGATIVE : un email jetable que MailGuard a classé VALID par erreur
 *   - FALSE_POSITIVE : un email légitime que MailGuard a classé INVALID par erreur
 *
 * Fonctionnement en 3 étapes :
 *   1. Vérifier si une correction validée existe déjà en base (priorité maximale)
 *   2. Compter les signalements en attente — si le seuil est atteint, appliquer la correction
 *   3. Sinon, retourner un score proportionnel au nombre de signalements reçus
 *
 * Les corrections crowdsourcées priment sur tous les autres modules dans l'agrégateur.
 *
 * @param {string} email  - adresse email complète (ex: "user@spam.com")
 * @param {string} domain - domaine extrait de l'email (ex: "spam.com")
 * @returns {{ reports: number, score: number, correction: string|null, reasons: string[] }}
 */
async function analyze(email, domain) {
  const reasons = [];

  // ── Étape 1 : Correction déjà validée en base ─────────────────────────────
  // Si une correction crowdsource a déjà été appliquée pour ce domaine,
  // on la retourne directement sans recalculer — priorité absolue.
  const domainRecord = await Domain.findOne({ domain, source: 'crowdsource', active: true });

  if (domainRecord) {
    if (domainRecord.isDisposable) {
      // Le domaine a été confirmé jetable par la communauté → score maximal
      return {
        reports:    domainRecord.reportCount,
        score:      50,
        correction: 'FORCE_INVALID',
        reasons:    ['Domaine marqué jetable par signalements validés'],
      };
    } else {
      // Le domaine a été réhabilité par la communauté → score nul
      return {
        reports:    domainRecord.reportCount,
        score:      0,
        correction: 'FORCE_VALID',
        reasons:    ['Domaine marqué légitime par signalements validés'],
      };
    }
  }

  // ── Étape 2 : Compter les signalements en attente ─────────────────────────
  // On compte séparément les deux types de signalements pour ce domaine.
  // Les signalements non encore validés (validated: false) sont en attente.
  const falseNegativeCount  = await Report.countDocuments({ domain, type: 'FALSE_NEGATIVE',  validated: false });
  const falsePositiveCount  = await Report.countDocuments({ domain, type: 'FALSE_POSITIVE',  validated: false });

  // Seuil FALSE_NEGATIVE atteint → le domaine est confirmé jetable
  if (falseNegativeCount >= VALIDATION_THRESHOLD) {
    await applyCorrection(domain, true, falseNegativeCount);
    reasons.push(`${falseNegativeCount} signalements FALSE_NEGATIVE — domaine marqué jetable`);
    return { reports: falseNegativeCount, score: 50, correction: 'FORCE_INVALID', reasons };
  }

  // Seuil FALSE_POSITIVE atteint → le domaine est réhabilité
  if (falsePositiveCount >= VALIDATION_THRESHOLD) {
    await applyCorrection(domain, false, falsePositiveCount);
    reasons.push(`${falsePositiveCount} signalements FALSE_POSITIVE — domaine réhabilité`);
    return { reports: falsePositiveCount, score: 0, correction: 'FORCE_VALID', reasons };
  }

  // ── Étape 3 : Score proportionnel ─────────────────────────────────────────
  // Seuil non atteint → score partiel proportionnel au nombre de FALSE_NEGATIVE reçus.
  // Maximum 23 points selon le CDC (section 6.7), atteint exactement au seuil.
  const totalReports = falseNegativeCount + falsePositiveCount;
  const score = Math.min(23, Math.round((falseNegativeCount / VALIDATION_THRESHOLD) * 23));

  if (totalReports > 0) {
    reasons.push(`${totalReports} signalement(s) en attente de validation`);
  }

  return { reports: totalReports, score, correction: null, reasons };
}

/**
 * Enregistre ou met à jour la correction crowdsource d'un domaine dans MongoDB.
 * Utilise upsert pour éviter les doublons si le domaine n'existe pas encore en base.
 *
 * @param {string}  domain       - domaine concerné
 * @param {boolean} isDisposable - true = jetable confirmé, false = légitime confirmé
 * @param {number}  reportCount  - nombre de signalements ayant déclenché la correction
 */
async function applyCorrection(domain, isDisposable, reportCount) {
  await Domain.findOneAndUpdate(
    { domain },
    {
      $set: {
        isDisposable,
        source:      'crowdsource',
        active:      true,
        reportCount,
        updatedAt:   new Date(),
      },
      // $setOnInsert ne s'exécute qu'à la création (upsert) — évite d'écraser addedAt
      $setOnInsert: { domain, addedAt: new Date() },
    },
    { upsert: true }
  );
}

module.exports = { analyze, VALIDATION_THRESHOLD };
