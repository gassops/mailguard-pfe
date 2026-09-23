#!/usr/bin/env bash
# Lance un scénario k6, relit dans Prometheus ce que le SERVEUR a mesuré sur exactement la
# même fenêtre (P95/P99, hit ratio, 5xx) et capture le dashboard SLO Grafana figé sur cette
# fenêtre (les quatre scénarios) : mesures et captures du rapport sont reproductibles, sans régler
# « Last 15 minutes » à la main.
#
# Usage   : API_KEY=mg_xxx tests/k6/run_scenario.sh nominal|stress|spike|cache
# Options : THINK_TIME (défaut 1) ; CAPTURE_DIR=<dossier> pour enregistrer les captures PNG
#           (avec GRAFANA_PASSWORD et un port-forward :
#            kubectl port-forward -n mailguard svc/grafana 3002:3000) ;
#           SHOT_DIR=<dossier contenant node_modules/puppeteer-core>
# Sortie  : tests/k6/results/<scénario>_<horodatage>.{txt,json}
set -uo pipefail

SCENARIO="${1:?usage: $0 nominal|stress|spike|cache}"
: "${API_KEY:?API_KEY manquante}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export API_KEY BASE_URL="${BASE_URL:-http://mailguard.local}" THINK_TIME="${THINK_TIME:-1}"
export RUN_ID="${RUN_ID:-$(date +%s)}"
NS="${NS:-mailguard}"
SCRIPT="$HERE/${SCENARIO}.js"
[ -f "$SCRIPT" ] || { echo "scénario inconnu : $SCENARIO" >&2; exit 2; }
case "$SCENARIO" in stress) SLO_P95=0.5 ;; spike) SLO_P95=60 ;; *) SLO_P95=0.2 ;; esac   # objectif de latence du scénario (s) ; spike : aucun (60 s = délai k6)
case "$SCENARIO" in cache) SLO_CACHE=1 ;; *) SLO_CACHE=0 ;; esac   # SLO de cache évalué seulement par le scénario cache (les autres génèrent des adresses inédites : hit ratio nul par construction)
OUT="$HERE/results"; mkdir -p "$OUT"; STAMP="$(date +%Y%m%d_%H%M%S)"

START=$(date +%s)
k6 run --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
       --summary-export="$OUT/${SCENARIO}_${STAMP}.json" "$SCRIPT" 2>&1 | tee "$OUT/${SCENARIO}_${STAMP}.txt"
K6_RC=${PIPESTATUS[0]}
END=$(date +%s)

echo; echo "Attente du dernier scrape Prometheus (25 s)..."; sleep 25
READY=$(kubectl get deploy api -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "?")

python3 - "$NS" "$START" "$END" "$READY" "$SCENARIO" <<'PY' | tee -a "$OUT/${SCENARIO}_${STAMP}.txt"
import json, subprocess, sys, urllib.parse
from datetime import datetime
ns, start, end, ready, scenario = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
t_eval = end + 25; dur = t_eval - start

def prom(expr):
    url = "http://localhost:9090/api/v1/query?" + urllib.parse.urlencode({"query": expr, "time": t_eval})
    out = subprocess.run(["kubectl", "exec", "-n", ns, "deploy/prometheus", "--", "wget", "-qO-", url],
                         capture_output=True, text=True)
    try:
        res = json.loads(out.stdout)["data"]["result"]
    except Exception:
        return None
    return float(res[0]["value"][1]) if res else None

R = 'job="mailguard-api",route="/verify"'
total = prom(f'sum(increase(http_requests_total{{{R}}}[{dur}s]))')
err5  = prom(f'sum(increase(http_requests_total{{{R},status=~"5.."}}[{dur}s]))') or 0.0
q = lambda p: prom(f'histogram_quantile({p}, sum by (le) (increase(http_request_duration_seconds_bucket{{{R}}}[{dur}s])))')
p95, p99 = q(0.95), q(0.99)
hits = prom(f'sum(increase(mailguard_cache_hits_total[{dur}s]))') or 0.0
miss = prom(f'sum(increase(mailguard_cache_misses_total[{dur}s]))') or 0.0
targets = prom('count(up{job="mailguard-api"} == 1)')
ms = lambda v: "n/a" if v is None else f"{v * 1000:.0f} ms"

print("=" * 68); print(f" SLI mesurés côté serveur (Prometheus) — scénario {scenario}"); print("=" * 68)
print(f" fenêtre          : {datetime.fromtimestamp(start):%H:%M:%S} -> {datetime.fromtimestamp(end):%H:%M:%S} ({end - start} s)")
print(f" requêtes /verify : {'n/a' if total is None else f'{total:.0f}'}")
print(f" latence P95      : {ms(p95)}\n latence P99      : {ms(p99)}")
print(f" erreurs 5xx      : {0 if not total else 100 * err5 / total:.3f} %  (disponibilité {100 if not total else 100 * (1 - err5 / total):.3f} %)")
print(f" cache hit ratio  : {0 if hits + miss == 0 else 100 * hits / (hits + miss):.1f} %  ({hits:.0f} hits / {hits + miss:.0f})")
ok = targets is not None and ready not in ("?", "") and int(targets) == int(ready)
print(f" pods API         : {ready} prêts, {'?' if targets is None else int(targets)} scrapés " + ("(une série par pod)" if ok else "/!\\ écart : mesures à vérifier"))
print("=" * 68)
PY

# Rapport : une seule capture (dashboard SLO) par scénario.
if [ -n "${CAPTURE_DIR:-}" ] && [ -n "${GRAFANA_PASSWORD:-}" ]; then
  FROM=$(( (START - 30) * 1000 )); TO=$(( (END + 45) * 1000 ))
  ( cd "${SHOT_DIR:-$HERE}" && export NODE_PATH="${SHOT_DIR:-$HERE}/node_modules" && \
    node "$HERE/capture_grafana.js" mailguard-slo "$FROM" "$TO" "$CAPTURE_DIR/k6_${SCENARIO}_apres_slo.png" "slo_p95=$SLO_P95" "slo_cache=$SLO_CACHE" )
fi
echo "k6 exit code : $K6_RC  (0 = tous les seuils respectés, 99 = au moins un seuil franchi)"
exit $K6_RC
