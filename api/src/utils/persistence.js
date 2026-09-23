/**
 * Écritures et lectures du CHEMIN CHAUD de /verify, via le pilote MongoDB natif
 * (Model.collection) plutôt que via les documents Mongoose.
 *
 * Pourquoi : le profil CPU de l'API sous charge nominale (50 utilisateurs) attribuait plus de la
 * moitié du temps à Mongoose et à son pilote — création d'un document avec objet imbriqué,
 * casting des mises à jour (Schema.hasMixedParent, Document.$set, castUpdate...) — c'est-à-dire à
 * de la conversion, pas à du travail utile. Le pilote natif écrit le même document sans cette
 * couche. Mongoose reste utilisé partout ailleurs (modèles, index, routes peu fréquentes).
 *
 * Contrepartie : ni validation ni valeurs par défaut du schéma sur ces écritures. Les valeurs sont
 * produites par le code lui-même (verdict issu de l'agrégateur, dates générées ici) et
 * persistedDetails() reproduit exactement la forme que le schéma Verification conserverait.
 */
const { Types } = require('mongoose');
const Verification = require('../models/Verification');
const Client       = require('../models/Client');

/** Sous-ensemble de `details` persisté (identique au schéma Verification.details). */
function persistedDetails(d) {
  return {
    blacklist:     { flagged: d.blacklist.flagged,         score: d.blacklist.score },
    mx_check:      { valid: d.mx_check.valid,              score: d.mx_check.score },
    smtp_check:    { exists: d.smtp_check.exists,          score: d.smtp_check.score },
    domain_age:    { days: d.domain_age.days,              score: d.domain_age.score },
    ml_classifier: { probability: d.ml_classifier.probability, score: d.ml_classifier.score },
    crowdsource:   { reports: d.crowdsource.reports,       score: d.crowdsource.score },
  };
}

/** Insère une vérification ; retourne le document inséré (avec son _id). */
async function insertVerification({ clientId, email, domain, score, verdict, details, processingTimeMs }) {
  const doc = {
    _id: new Types.ObjectId(),
    clientId, email, domain, score, verdict,
    details: persistedDetails(details),
    processingTimeMs,
    cached: false,
    createdAt: new Date(), // index TTL (90 jours) : doit être un Date
  };
  await Verification.collection.insertOne(doc);
  return doc;
}

/** Met à jour score, verdict et détails une fois la sonde SMTP terminée. */
function updateVerification(id, { score, verdict, details }) {
  return Verification.collection.updateOne(
    { _id: id },
    { $set: { score, verdict, details: persistedDetails(details) } }
  );
}

/** Consomme une unité du quota mensuel du client. */
function incrementQuota(clientId) {
  return Client.collection.updateOne({ _id: clientId }, { $inc: { quotaUsed: 1 } });
}

/** Authentification par clé API : document brut (équivalent de findOne(...).lean()). */
function findActiveClientByApiKey(apiKey) {
  return Client.collection.findOne({ apiKey, active: true });
}

module.exports = { insertVerification, updateVerification, incrementQuota, findActiveClientByApiKey, persistedDetails };
