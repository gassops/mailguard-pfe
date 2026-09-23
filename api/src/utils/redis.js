const Redis = require('ioredis');

let client;

async function connectRedis() {
  client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db:   parseInt(process.env.REDIS_DB   || '0'), // db 1 en tests, db 0 en prod
    retryStrategy: (times) => Math.min(times * 50, 2000),
    // Sans délai maximal, une commande vers un Redis figé n'échoue jamais : la requête HTTP qui
    // l'attend reste bloquée jusqu'au timeout du client (60 s observés). Avec un délai, l'erreur
    // remonte en 1 s et les chemins « Redis indisponible » de l'API (fail-open, cache facultatif)
    // prennent le relais : le service se dégrade au lieu de se figer.
    commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || '1000', 10),
    maxRetriesPerRequest: 2,
  });

  client.on('connect', () => console.log('Redis connecté'));
  client.on('error',   (err) => console.error('Redis erreur :', err.message));

  return client;
}

// Getter partagé — tous les modules importent getRedis() pour utiliser le client
function getRedis() {
  if (!client) throw new Error('Redis non initialisé');
  return client;
}

module.exports = connectRedis;
module.exports.getRedis = getRedis;
