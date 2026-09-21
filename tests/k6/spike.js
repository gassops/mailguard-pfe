// Test de SPIKE — CDC : 0 → 500 utilisateurs en 30 sec, durée totale 2 min,
// critère de succès : pas de crash, récupération en < 1 min.
//
// "Pas de crash" est vérifié par ce script (les requêtes reçoivent une vraie
// réponse HTTP, pas une erreur de connexion). "Récupération en < 1 min" doit
// en revanche être vérifiée VISUELLEMENT dans Grafana après le run : les 60
// dernières secondes du test (phase basse après le pic) sont précisément la
// fenêtre de récupération à observer — la latence/le taux d'erreur doivent
// revenir à la normale dans cette fenêtre.
//
// Usage :
//   BASE_URL=http://mailguard.local API_KEY=mg_xxx k6 run tests/k6/spike.js
//
// Résultats à documenter avec une capture Grafana couvrant tout le run
// (pic + fenêtre de récupération).

import http from 'k6/http';
import { check, sleep } from 'k6';

// Temps de réflexion entre deux requêtes d'un même utilisateur virtuel (secondes).
// 0 (défaut) = boucle sans pause, test de capacité maximale ; THINK_TIME=1 modélise
// un utilisateur réel. Usage : THINK_TIME=1 BASE_URL=... API_KEY=... k6 run ...
const THINK_TIME = parseFloat(__ENV.THINK_TIME || '0');

// Identifiant unique du run : rend chaque adresse de test inédite. Sans lui, deux runs
// à moins d'une heure d'écart réutiliseraient des adresses déjà en cache (TTL 1 h) et
// mesureraient le cache au lieu du moteur d'analyse.
const RUN_ID = __ENV.RUN_ID || Date.now().toString(36);

const BASE_URL = __ENV.BASE_URL || 'http://mailguard.local';
const API_KEY  = __ENV.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY manquante — voir le commentaire en tête de fichier pour l\'usage');
}

const DOMAINS = [
  'gmail.com', 'outlook.com', 'mailinator.com', 'yopmail.com', 'jobraux.com',
];

export const options = {
  stages: [
    { duration: '30s', target: 500 },  // pic brutal : 0 -> 500 en 30s — critère CDC
    { duration: '20s', target: 500 },  // maintien du pic
    { duration: '10s', target: 0 },    // chute rapide
    { duration: '1m',  target: 0 },    // fenêtre de récupération (< 1 min) — à observer dans Grafana
  ],
  thresholds: {
    // "Pas de crash" : les requêtes doivent recevoir une vraie réponse HTTP
    // (200 ou 429 rate-limit = système qui répond correctement, pas qui tombe).
    // Une proportion élevée d'échecs de connexion (status 0) indiquerait un crash.
    http_req_failed: ['rate<0.20'],
  },
};

export default function () {
  const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  const email  = `spiketest_${RUN_ID}_${__VU}_${__ITER}@${domain}`;

  const res = http.post(
    `${BASE_URL}/api/v1/verify`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY } }
  );

  check(res, {
    'a répondu, pas de crash (200 ou 429, pas 0/5xx)': (r) => r.status === 200 || r.status === 429,
  });

  if (THINK_TIME > 0) sleep(THINK_TIME);
}
