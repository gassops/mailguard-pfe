#!/usr/bin/env node
/**
 * Capture d'écran d'un dashboard Grafana sur une fenêtre de temps figée (Chrome headless).
 * Reproductible : la fenêtre est passée en paramètre, pas réglée à la main dans l'UI.
 *
 * Prérequis : npm i puppeteer-core (dans un dossier de travail), Google Chrome installé,
 *             kubectl port-forward -n mailguard svc/grafana 3002:3000
 *
 * Usage : GRAFANA_USER=admin GRAFANA_PASSWORD=... node capture_grafana.js \
 *           <uid> <fromMs> <toMs> <sortie.png> [var=valeur ...]
 *   ex. : node capture_grafana.js mailguard-slo 1789930000000 1789930400000 nominal.png slo_p95=0.2
 */
const puppeteer = require('puppeteer-core');

const [uid, from, to, out, ...vars] = process.argv.slice(2);
if (!uid || !from || !to || !out) {
  console.error('usage: capture_grafana.js <uid> <fromMs> <toMs> <out.png> [var=valeur ...]');
  process.exit(2);
}
const BASE = process.env.GRAFANA_URL || 'http://localhost:3002';
const USER = process.env.GRAFANA_USER || 'admin';
const PASS = process.env.GRAFANA_PASSWORD;
if (!PASS) { console.error('GRAFANA_PASSWORD manquant'); process.exit(2); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Connexion par l'API de login (le cookie de session est posé sur le navigateur) :
    // plus fiable que de piloter le formulaire, dont la navigation dépend du client Grafana.
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    const status = await page.evaluate(async (user, password) => {
      const r = await fetch('/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      return r.status;
    }, USER, PASS);
    if (status !== 200) throw new Error(`login Grafana refusé (HTTP ${status})`);

    const qs = new URLSearchParams({ orgId: '1', from, to, kiosk: '' });
    for (const v of vars) { const [k, val] = v.split('='); qs.append(`var-${k}`, val); }
    const url = `${BASE}/d/${uid}?${qs.toString().replace('kiosk=', 'kiosk')}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Laisse les requêtes Prometheus se terminer et les panneaux se dessiner.
    await page.waitForSelector('[data-testid*="Panel"], .panel-container, section[class*="panel"]', { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 9000));
    await page.screenshot({ path: out, type: 'png' });
    console.log(`capture : ${out}\n  ${url}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('ECHEC capture :', e.message); process.exit(1); });
