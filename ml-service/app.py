"""
app.py — Flask API d'inference du Module 5 (ML Classifier)
============================================================
Endpoints :
  GET  /health   → etat du service + modele charge
  POST /predict  → { domain } → { score, probability, is_disposable }
"""

import os
import logging

import numpy as np
import joblib
from flask import Flask, request, jsonify

from train import extract_features, FEATURE_COLUMNS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# CHARGEMENT DU MODELE AU DEMARRAGE
# ─────────────────────────────────────────────────────────────────────────────

MODEL_PATH = os.getenv("MODEL_PATH", "model/classifier.pkl")

_model    = None
_features = FEATURE_COLUMNS

try:
    artifact  = joblib.load(MODEL_PATH)
    _model    = artifact["model"]
    _features = artifact.get("features", FEATURE_COLUMNS)
    _version  = artifact.get("version", "?")
    _algo     = artifact.get("algorithm", "?")
    logger.info(f"Modele charge : {_algo} v{_version}  ({MODEL_PATH})")
except FileNotFoundError:
    logger.error(
        f"Modele introuvable : {MODEL_PATH}. "
        "Lancez d'abord : python train.py"
    )
except Exception as e:
    logger.error(f"Erreur de chargement du modele : {e}")


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """Sonde de sante — utilisee par Docker et le module Node.js."""
    return jsonify({
        "status":       "ok" if _model is not None else "degraded",
        "model_loaded": _model is not None,
        "model_path":   MODEL_PATH,
    }), 200 if _model is not None else 503


@app.route("/predict", methods=["POST"])
def predict():
    """
    Predit si un domaine est jetable.

    Body JSON :
      {
        "domain": "example.com"   // obligatoire
      }

    Reponse 200 :
      {
        "domain":        "example.com",
        "probability":   0.87,             // P(jetable) en [0, 1]
        "score":         13,               // score partiel en [0, 15]
        "is_disposable": true
      }
    """
    if _model is None:
        return jsonify({"error": "Modele non charge. Lancez train.py."}), 503

    body = request.get_json(silent=True) or {}

    domain = str(body.get("domain", "")).strip().lower()
    if not domain or "." not in domain:
        return jsonify({"error": "Champ 'domain' obligatoire (ex: example.com)"}), 400

    try:
        feats = extract_features(domain)
        X = np.array([[feats[f] for f in _features]])

        probability   = float(_model.predict_proba(X)[0][1])
        is_disposable = probability >= 0.5

        # Mapping lineaire probabilite → score partiel 0-15
        score = min(15, round(probability * 15))

        return jsonify({
            "domain":        domain,
            "probability":   round(probability, 4),
            "score":         score,
            "is_disposable": is_disposable,
        })

    except Exception as e:
        logger.error(f"Erreur de prediction pour '{domain}' : {e}")
        return jsonify({"error": "Prediction echouee", "detail": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POINT D'ENTREE (dev uniquement — production utilise gunicorn)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
