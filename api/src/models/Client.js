const mongoose = require('mongoose');
const bcrypt   = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const clientSchema = new mongoose.Schema({
  name:             { type: String, required: true },
  email:            { type: String, required: true, unique: true, lowercase: true },
  password:         { type: String, required: true },
  apiKey:           { type: String, unique: true, default: () => `mg_${uuidv4().replace(/-/g, '')}` },
  rateLimitPerMin:  { type: Number, default: 100 },
  quotaLimit:       { type: Number, default: 100 },
  quotaUsed:        { type: Number, default: 0 },
  quotaResetAt:     { type: Date, default: () => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1, 1)
    d.setHours(0, 0, 0, 0)
    return d
  }},
  webhookUrl:       { type: String, default: null },
  thresholds: {
    suspicious: { type: Number, default: 21 },
    invalid:    { type: Number, default: 51 },
  },
  active:    { type: Boolean, default: true },
  createdAt: { type: Date,    default: Date.now },
});

clientSchema.index({ apiKey: 1 });

// Hash le mot de passe avant chaque save si modifié
clientSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

clientSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('Client', clientSchema);
