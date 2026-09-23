#!/usr/bin/env bash
# Campagne complète de validation des SLOs : spike (à froid) -> cache -> nominal -> stress.
# Chaque scénario est précédé d'une attente du retour de l'HPA à son minimum (2 réplicas),
# pour que les runs partent des mêmes conditions (état « à froid »). Durée totale : ~45 min.
#
# Usage : API_KEY=mg_xxx GRAFANA_PASSWORD=... tests/k6/campagne.sh
#         (port-forward Grafana actif sur 3002 : kubectl port-forward -n mailguard svc/grafana 3002:3000)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${API_KEY:?API_KEY manquante}"
export CAPTURE_DIR="${CAPTURE_DIR:-/home/mg/PFE_Latex/figures/chap6}"
export THINK_TIME="${THINK_TIME:-1}"
NS="${NS:-mailguard}"

wait_cold() {
  MINR=$(kubectl get hpa api-hpa -n "$NS" -o jsonpath='{.spec.minReplicas}' 2>/dev/null || echo 2)
  echo ">>> attente du retour de l'API à ${MINR} réplicas, le minimum de l'HPA (max 12 min)..."
  for _ in $(seq 1 72); do
    r=$(kubectl get deploy api -n "$NS" -o jsonpath='{.status.replicas}' 2>/dev/null)
    [ "${r:-0}" -le "$MINR" ] && { echo ">>> API à ${r} réplicas"; sleep 20; return; }
    sleep 10
  done
  echo ">>> /!\\ l'API n'est pas revenue à ${MINR} réplicas : le run part d'un état plus chaud" >&2
}

for s in spike cache nominal stress; do
  wait_cold
  echo; echo "################ scénario : $s ################"
  "$HERE/run_scenario.sh" "$s"
  echo ">>> $s terminé (code $?)"
done
echo; echo "Campagne terminée. Résultats : $HERE/results/ ; captures : $CAPTURE_DIR"
# Met à jour les chiffres du rapport (chapitre 6) à partir des résultats de cette campagne.
echo ">>> mise à jour des mesures du rapport"
python3 "$HERE/results_to_tex.py" || echo ">>> /!\\ au moins un objectif n'est pas atteint : voir ci-dessus, le texte du chapitre 6 est à revoir"
echo ">>> recompiler le rapport : cd /home/mg/PFE_Latex && latexmk -pdf -outdir=build main.tex"
