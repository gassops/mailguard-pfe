const axios = require('axios');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml:5000';
const TIMEOUT_MS     = parseInt(process.env.ML_TIMEOUT_MS || '3000', 10);

/**
 * Module 5 — ML Classifier
 *
 * Appelle le service Python (RandomForest) pour detecter les domaines jetables
 * inconnus des listes statiques, en se basant sur leurs caracteristiques
 * structurelles (entropie, TLD, age, mots-cles suspects, etc.).
 *
 * Score partiel : 0 a 15 selon P(jetable)
 * Poids         : 0.15
 *
 * Comportement fail-open : si le service ML est indisponible,
 * on retourne score=0 pour ne pas bloquer le pipeline d'analyse.
 *
 * @param {string} email  - adresse email complete
 * @param {string} domain - domaine extrait de l'email
 * @returns {{ score: number, probability: number, is_disposable: boolean, reasons: string[], error?: string }}
 */
async function analyze(email, domain) {
  const reasons = [];

  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/predict`,
      { domain },
      {
        timeout: TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const score        = data.score         ?? 0;
    const probability  = data.probability   ?? 0;
    const is_disposable = data.is_disposable ?? false;

    if (is_disposable) {
      reasons.push(
        `Domaine suspect selon le classificateur ML (probabilite: ${(probability * 100).toFixed(1)}%)`
      );
    }

    return { score, probability, is_disposable, reasons };

  } catch (err) {
    // Fail-open : le ML est un signal supplementaire, pas bloquant.
    // On distingue timeout vs service indisponible pour faciliter le debug.
    const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
    reasons.push(
      isTimeout
        ? 'Service ML timeout — score neutre applique'
        : 'Service ML indisponible — score neutre applique'
    );

    return {
      score:          0,
      probability:    0,
      is_disposable:  false,
      reasons,
      error:          err.message,
    };
  }
}

module.exports = { analyze };
