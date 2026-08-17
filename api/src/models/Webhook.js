const mongoose = require('mongoose');

const webhookSchema = new mongoose.Schema({
  clientId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  url:           { type: String, required: true },
  // Liste des événements déclencheurs — pour l'instant uniquement INVALID
  events:        { type: [String], default: ['INVALID'] },
  active:        { type: Boolean, default: true },
  // Secret HMAC — permet au client de vérifier que la notification vient bien de MailGuard
  secret:        { type: String, default: null },
  lastTriggered: { type: Date, default: null },
  createdAt:     { type: Date, default: Date.now },
});

webhookSchema.index({ clientId: 1 });

module.exports = mongoose.model('Webhook', webhookSchema);
