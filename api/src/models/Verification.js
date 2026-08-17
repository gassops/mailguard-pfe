const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  email:    { type: String, required: true },
  domain:   { type: String, required: true },
  score:    { type: Number, min: 0, max: 100 },
  verdict:  { type: String, enum: ['VALID', 'SUSPICIOUS', 'INVALID'] },
  // Détail des scores de chaque module — correspond exactement au format de réponse du CDC
  details: {
    blacklist:     { flagged: Boolean, score: Number },
    mx_check:      { valid: Boolean,   score: Number },
    smtp_check:    { exists: Boolean,  score: Number },
    domain_age:    { days: Number,     score: Number },
    ml_classifier: { probability: Number, score: Number },
    crowdsource:   { reports: Number,  score: Number },
  },
  processingTimeMs: Number,
  cached:    { type: Boolean, default: false },
  // TTL MongoDB : supprime automatiquement les logs après 90 jours
  createdAt: { type: Date, default: Date.now, expires: '90d' },
});

verificationSchema.index({ clientId: 1, createdAt: -1 });
verificationSchema.index({ email: 1 });

module.exports = mongoose.model('Verification', verificationSchema);
