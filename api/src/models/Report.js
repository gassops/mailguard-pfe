const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  clientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  email:       { type: String, required: true, lowercase: true },
  domain:      { type: String, required: true },
  // FALSE_POSITIVE : email légitime classé INVALID par erreur
  // FALSE_NEGATIVE : email jetable classé VALID par erreur
  type:        { type: String, enum: ['FALSE_POSITIVE', 'FALSE_NEGATIVE'], required: true },
  validated:   { type: Boolean, default: false },
  validatedAt: { type: Date, default: null },
  createdAt:   { type: Date, default: Date.now },
});

reportSchema.index({ email: 1, type: 1 });

module.exports = mongoose.model('Report', reportSchema);
