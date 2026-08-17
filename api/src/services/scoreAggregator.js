/**
 * Score Aggregator — MailGuard
 * ============================
 * Combine les scores partiels des 6 modules d'analyse en un score final
 * pondéré (0-100) et détermine le verdict : VALID / SUSPICIOUS / INVALID.
 *
 * Formule :
 *   score_final = Σ (score_module / max_module) × 100 × poids_module
 *
 * Chaque score partiel est d'abord normalisé sur 100, puis pondéré.
 * La somme des poids vaut exactement 1.0 → score final ∈ [0, 100].
 *
 * Seuils par défaut (configurables par client via MongoDB) :
 *   0  – 20  → VALID
 *   21 – 50  → SUSPICIOUS
 *   51 – 100 → INVALID
 *
 * Cas spéciaux crowdsource (priorité absolue) :
 *   correction = FORCE_INVALID → verdict INVALID quoi que soit le score
 *   correction = FORCE_VALID   → verdict VALID   quoi que soit le score
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION DES POIDS
// Doit rester cohérent avec diagramme-classe.puml et le CDC section 6
// ─────────────────────────────────────────────────────────────────────────────

// blacklist à 0.55 : un domaine blacklisté (score max 50/50 → 100% → 55 pts)
// dépasse a lui seul le seuil INVALID (51) — un domaine jetable CONNU doit
// toujours être INVALID, indépendamment des autres modules.
// ml à 0.15 (inchangé) : une tentative à 0.20 a été testée mais REJETÉE —
// preuve empirique que le classifieur lexical seul confond parfois un
// domaine légitime ordinaire (gmail.com : 95% "jetable" selon le modèle,
// car lexicalement indiscernable d'un domaine jetable "propre" comme
// jobraux.com — limite structurelle documentée dans train.py). À 0.20, ce
// faux positif combiné au score neutre de domainAge (WHOIS en échec → 5/10)
// suffisait à faire basculer gmail.com en SUSPICIOUS. À 0.15, la marge de
// sécurité est confirmée : ml (max 15) + domainAge neutre (3.5) = 18.5 < 21.
// crowdsource abaissé (0.05 → 0.03) : signal secondaire, lent à se déclencher
// (seuil de 3 signalements), ne doit pas peser autant que les détections
// automatiques. mx/smtp/domainAge réduits proportionnellement pour que la
// somme reste exactement 1.0.
const WEIGHTS = {
  blacklist:   { weight: 0.55, max: 50 },
  mx:          { weight: 0.10, max: 20 },
  smtp:        { weight: 0.10, max: 15 },
  domainAge:   { weight: 0.07, max: 10 },
  ml:          { weight: 0.15, max: 15 },
  crowdsource: { weight: 0.03, max: 50 },
};

const DEFAULT_THRESHOLDS = {
  suspicious: 21,
  invalid:    51,
};

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS PRINCIPALES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcule le score final pondéré à partir des résultats des 6 modules.
 *
 * @param {Object} results - { blacklist, mx, smtp, domainAge, ml, crowdsource }
 * @returns {number} score entier entre 0 et 100
 */
function computeWeightedScore(results) {
  let total = 0;

  for (const [key, { weight, max }] of Object.entries(WEIGHTS)) {
    const raw        = results[key]?.score ?? 0;
    const clamped    = Math.min(raw, max);          // sécurité : ne dépasse pas le max déclaré
    const normalized = (clamped / max) * 100;       // 0-100
    total           += normalized * weight;
  }

  return Math.min(100, Math.round(total));
}

/**
 * Détermine le verdict à partir du score et des seuils client.
 *
 * @param {number} score         - score final 0-100
 * @param {string|null} correction - correction crowdsource ('FORCE_INVALID' | 'FORCE_VALID' | null)
 * @param {Object} thresholds    - { suspicious: number, invalid: number }
 * @returns {'VALID'|'SUSPICIOUS'|'INVALID'}
 */
function getVerdict(score, correction, thresholds = DEFAULT_THRESHOLDS) {
  // Corrections crowdsource — priorité absolue sur le score calculé
  if (correction === 'FORCE_INVALID') return 'INVALID';
  if (correction === 'FORCE_VALID')   return 'VALID';

  if (score >= thresholds.invalid)    return 'INVALID';
  if (score >= thresholds.suspicious) return 'SUSPICIOUS';
  return 'VALID';
}

/**
 * Point d'entrée principal — agrège tous les résultats et retourne le verdict final.
 *
 * @param {Object} results    - résultats des 6 modules
 * @param {Object} thresholds - seuils du client (depuis MongoDB), défauts si absent
 * @returns {{
 *   score:    number,
 *   verdict:  'VALID'|'SUSPICIOUS'|'INVALID',
 *   reasons:  string[],
 *   details:  Object
 * }}
 */
function _severity(score, max) {
  const pct = max > 0 ? score / max : 0;
  if (pct === 0)   return 'NONE';
  if (pct < 0.4)  return 'LOW';
  if (pct < 0.7)  return 'MEDIUM';
  return 'HIGH';
}

function aggregate(results, thresholds = DEFAULT_THRESHOLDS) {
  const score      = computeWeightedScore(results);
  const correction = results.crowdsource?.correction ?? null;
  const verdict    = getVerdict(score, correction, thresholds);

  const reasons = Object.values(results)
    .flatMap(r => r?.reasons ?? [])
    .filter(Boolean);

  const bl = results.blacklist ?? {};
  const mx = results.mx       ?? {};
  const sm = results.smtp     ?? {};
  const da = results.domainAge ?? {};
  const ml = results.ml       ?? {};
  const cr = results.crowdsource ?? {};

  return {
    score,
    verdict,
    reasons,
    // Clés alignées sur le frontend (VerificationDetails) + champs requis par computeAggregator
    details: {
      blacklist: {
        score:       bl.score      ?? 0,
        maxScore:    WEIGHTS.blacklist.max,
        weight:      WEIGHTS.blacklist.weight,
        severity:    _severity(bl.score ?? 0, WEIGHTS.blacklist.max),
        flagged:     bl.flagged    ?? false,
        domain:      bl.domain     ?? '',
        source:      bl.source     ?? '',
        isRoleEmail: bl.isRoleEmail ?? false,
        isTypo:      bl.isTypo     ?? false,
      },
      mx_check: {
        score:         mx.score          ?? 0,
        maxScore:      WEIGHTS.mx.max,
        weight:        WEIGHTS.mx.weight,
        severity:      _severity(mx.score ?? 0, WEIGHTS.mx.max),
        valid:         mx.valid          ?? false,
        records:       mx.records        ?? (mx.mx ? [mx.mx] : []),
        serverResponds: mx.serverResponds ?? mx.valid ?? false,
      },
      smtp_check: {
        score:        sm.score        ?? 0,
        maxScore:     WEIGHTS.smtp.max,
        weight:       WEIGHTS.smtp.weight,
        severity:     _severity(sm.score ?? 0, WEIGHTS.smtp.max),
        exists:       sm.exists       ?? false,
        responseCode: sm.responseCode ?? 0,
        status:       sm.status       ?? 'UNKNOWN',
      },
      domain_age: {
        score:     da.score     ?? 0,
        maxScore:  WEIGHTS.domainAge.max,
        weight:    WEIGHTS.domainAge.weight,
        severity:  _severity(da.score ?? 0, WEIGHTS.domainAge.max),
        days:      da.days      ?? 0,
        createdAt: da.createdAt ?? 'N/A',
        registrar: da.registrar ?? 'N/A',
        riskLevel: da.riskLevel ?? 'LOW',
      },
      ml_classifier: {
        score:       ml.score       ?? 0,
        maxScore:    WEIGHTS.ml.max,
        weight:      WEIGHTS.ml.weight,
        severity:    _severity(ml.score ?? 0, WEIGHTS.ml.max),
        probability: ml.probability ?? 0,
        topFeatures: ml.topFeatures ?? [],
      },
      crowdsource: {
        score:     cr.score     ?? 0,
        maxScore:  WEIGHTS.crowdsource.max,
        weight:    WEIGHTS.crowdsource.weight,
        severity:  _severity(cr.score ?? 0, WEIGHTS.crowdsource.max),
        reports:   cr.reports   ?? 0,
        validated: cr.validated ?? (cr.correction === 'FORCE_INVALID'),
        threshold: cr.threshold ?? 3,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRE
// ─────────────────────────────────────────────────────────────────────────────

function _pick(obj, keys) {
  if (!obj) return {};
  return keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { aggregate, getVerdict, computeWeightedScore, WEIGHTS, DEFAULT_THRESHOLDS };
