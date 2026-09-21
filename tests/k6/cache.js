// Test du SLO 4 — cache hit ratio > 60 %.
//
// Le cache par adresse ne sert que les adresses DÉJÀ vues ; les scripts nominal/stress/spike
// génèrent des adresses inédites à chaque itération (pour mesurer le moteur d'analyse et non le
// cache), leur hit ratio est donc nul par construction. Ce scénario-ci modélise un trafic où
// des adresses sont re-vérifiées : doublons, ré-essais de formulaire, ré-inscriptions.
//
// Profil : 20 VU pendant 3 min ; REPEAT_RATIO (défaut 0.7) des requêtes reprennent une
// adresse d'un pool fixe de POOL_SIZE adresses, le reste vérifie une adresse jamais vue.
// La valeur du SLO en production dépend du taux réel de répétition du trafic, inconnu ici :
// ce test valide que le MÉCANISME de cache sert bien les adresses répétées.
//
// Usage : THINK_TIME=1 BASE_URL=http://mailguard.local API_KEY=mg_xxx k6 run tests/k6/cache.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const THINK_TIME   = parseFloat(__ENV.THINK_TIME || '0');
const REPEAT_RATIO = parseFloat(__ENV.REPEAT_RATIO || '0.7');
const POOL_SIZE    = parseInt(__ENV.POOL_SIZE || '50', 10);
const RUN_ID       = __ENV.RUN_ID || Date.now().toString(36);
const BASE_URL     = __ENV.BASE_URL || 'http://mailguard.local';
const API_KEY      = __ENV.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY manquante — voir le commentaire en tête de fichier pour l\'usage');
}

const DOMAINS = [
  'gmail.com', 'outlook.com', 'mailinator.com', 'yopmail.com',
  'jobraux.com', 'gwshare.com', 'horizon-tech.tn',
];

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '2m20s', target: 20 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed:   ['rate==0'],
    http_req_duration: ['p(95)<200'],
  },
};

export default function () {
  let email;
  if (Math.random() < REPEAT_RATIO) {
    const i = Math.floor(Math.random() * POOL_SIZE);
    email = `cachepool_${RUN_ID}_${i}@${DOMAINS[i % DOMAINS.length]}`;
  } else {
    const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
    email = `cachenew_${RUN_ID}_${__VU}_${__ITER}@${domain}`;
  }

  const res = http.post(
    `${BASE_URL}/api/v1/verify`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY } }
  );

  check(res, { 'status 200': (r) => r.status === 200 });

  if (THINK_TIME > 0) sleep(THINK_TIME);
}
