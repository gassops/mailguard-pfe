/**
 * Script de seed — crée un client de test avec une clé API
 * Usage : node scripts/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Client   = require('../src/models/Client');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mailguard');
  console.log('MongoDB connecté');

  const existing = await Client.findOne({ email: 'test@mailguard.dev' });
  if (existing) {
    console.log('\n Client de test déjà existant :');
    console.log(`  Nom     : ${existing.name}`);
    console.log(`  API Key : ${existing.apiKey}`);
    await mongoose.disconnect();
    return;
  }

  const client = await Client.create({
    name:  'Client de test',
    email: 'test@mailguard.dev',
  });

  console.log('\n Client créé avec succès !');
  console.log(`  Nom     : ${client.name}`);
  console.log(`  API Key : ${client.apiKey}`);
  console.log('\n Utilise cette clé dans tes requêtes :');
  console.log(`  -H "X-API-Key: ${client.apiKey}"`);

  await mongoose.disconnect();
}

seed().catch(console.error);
