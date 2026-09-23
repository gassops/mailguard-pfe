// Test de STRESS — CDC : 200 utilisateurs simultanés, 10 min,
// critère de succès : taux d'erreur < 1%, p95 < 500ms.
//
// Contrairement au nominal (charge normale) et au spike (pic soudain), ce
// test maintient une charge soutenue au-delà de la capacité nominale pour
// vérifier que le système dégrade proprement (SLO relâché mais respecté)
// plutôt que de s'effondrer.
//
// Usage :
//   BASE_URL=http://mailguard.local API_KEY=mg_xxx k6 run tests/k6/stress.js
//
// Résultats à documenter avec une capture Grafana prise juste après le run.

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
  'gmail.com', 'outlook.com', 'mailinator.com', 'yopmail.com',
  'jobraux.com', 'gwshare.com', 'horizon-tech.tn',
];

export const options = {
  stages: [
    { duration: '1m', target: 200 },  // montée vers 200 utilisateurs simultanés
    { duration: '8m', target: 200 },  // charge de stress soutenue
    { duration: '1m', target: 0 },    // redescente
  ],
  thresholds: {
    http_req_failed:   ['rate<0.01'],   // taux d'erreur < 1% — critère CDC
    http_req_duration: ['p(95)<500'],   // p95 < 500ms — critère CDC
  },
};

export default function () {
  const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  const email  = `stresstest_${RUN_ID}_${__VU}_${__ITER}@${domain}`;

  const res = http.post(
    `${BASE_URL}/api/v1/verify`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY } }
  );

  check(res, {
    'status 200': (r) => r.status === 200,
  });

  if (THINK_TIME > 0) sleep(THINK_TIME);
}
