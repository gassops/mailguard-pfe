const mongoose = require('mongoose');

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return; // déjà connecté (tests)
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connecté :', process.env.MONGO_URI);
  } catch (err) {
    console.error('Erreur connexion MongoDB :', err.message);
    if (process.env.NODE_ENV === 'test') throw err; // Jest capture l'erreur
    process.exit(1);
  }
}

module.exports = connectMongo;
