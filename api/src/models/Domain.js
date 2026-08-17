const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  // Stocké en minuscules — normalisé à l'insertion
  domain:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  isDisposable: { type: Boolean, default: true },
  // Source d'ajout : github (cron), crowdsource (signalements), manual (admin)
  source:       { type: String, enum: ['github', 'crowdsource', 'manual'], default: 'github' },
  reportCount:  { type: Number, default: 0 },
  active:       { type: Boolean, default: true },
  addedAt:      { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
});


module.exports = mongoose.model('Domain', domainSchema);
