// Test de charge NOMINAL — CDC : 50 utilisateurs simultanés, 5 min,
// critère de succès : 0 erreur, p95 < 200ms.
//
// Usage :
//   BASE_URL=http://mailguard.local API_KEY=mg_xxx k6 run tests/k6/nominal.js
//
// Nécessite une clé API dédiée aux tests de charge (rateLimitPerMin/quotaLimit
// élevés — voir README), sinon le test bute sur notre propre rate-limiter
// plutôt que sur la vraie capacité du système.
//
// Résultats à documenter avec une capture Grafana (dashboard MailGuard —
// API Overview) prise juste après le run.

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

// Domaines mélangés : connus jetables (blacklist), légitimes reconnus, et
// aléatoires (jamais vus, forcent un cache miss + appel ML/WHOIS complet) —
// pour exercer les 6 modules et pas seulement le chemin le plus rapide (cache hit).
const DOMAINS = [
  'gmail.com', 'outlook.com', 'yahoo.com',
  'mailinator.com', 'yopmail.com', 'guerrillamail.com',
  'jobraux.com', 'gwshare.com',
];

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // montée vers 50 utilisateurs simultanés
    { duration: '4m',  target: 50 },  // charge nominale soutenue
    { duration: '30s', target: 0 },   // redescente
  ],
  thresholds: {
    http_req_failed:    ['rate==0'],           // 0 erreur — critère CDC
    http_req_duration:  ['p(95)<200', 'p(99)<500'], // p95 < 200ms et p99 < 500ms — SLO 2 (chapitre 3)
  },
};

export default function () {
  const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  const email  = `loadtest_${RUN_ID}_${__VU}_${__ITER}@${domain}`;

  const res = http.post(
    `${BASE_URL}/api/v1/verify`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY } }
  );

  check(res, {
    'status 200':          (r) => r.status === 200,
    'verdict present':     (r) => r.json('verdict') !== undefined,
    'score dans [0,100]':  (r) => {
      const s = r.json('score');
      return typeof s === 'number' && s >= 0 && s <= 100;
    },
  });

  if (THINK_TIME > 0) sleep(THINK_TIME);
}
