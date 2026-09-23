#!/usr/bin/env python3
"""Génère le dashboard « MailGuard — SLO » (monitoring/grafana/dashboards/mailguard-slo.json)
et l'insère dans le ConfigMap k8s/grafana.yaml (clé mailguard-slo.json).

Chaque SLI y est affiché face à son objectif, calculé sur TOUTE la plage de temps
sélectionnée ($__range) : ouvert sur la fenêtre d'un test k6, il donne le verdict
de conformité de ce test. Le SLO de latence dépend du scénario (variable slo_p95) ; le SLO de cache
n'est évalué que si le trafic peut produire des hits (variable slo_cache : 0 pour les scénarios à
adresses inédites, où le hit ratio est nul par construction ; 1 par défaut, donc en exploitation).

Usage : python3 monitoring/grafana/build_slo_dashboard.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
J = 'job="mailguard-api"'
V = f'{J},route="/verify"'
RNG = "$__range"

def inc(metric_sel):
    return f"sum(increase({metric_sel}[{RNG}]))"

TOTAL = inc(f"http_requests_total{{{V}}}")
ERR5  = inc(f'http_requests_total{{{V},status=~"5.."}}')
def q(p):
    return f"histogram_quantile({p}, sum by (le) (increase(http_request_duration_seconds_bucket{{{V}}}[{RNG}])))"
HITS, MISS = inc("mailguard_cache_hits_total"), inc("mailguard_cache_misses_total")

def steps(*pairs):
    return [{"color": c, "value": v} for c, v in pairs]

def stat(pid, title, expr, x, y, w, h, unit, decimals=None, thr=None, fixed=None, text="value", not_evaluated=None):
    defaults = {"unit": unit, "mappings": []}
    if not_evaluated:   # valeur sentinelle -1 -> libellé neutre (bleu) au lieu d'un rouge trompeur
        defaults["mappings"] = [{"type": "range", "options": {"from": -1.5, "to": -0.5, "result": {"text": not_evaluated, "color": "blue", "index": 0}}}]
    if decimals is not None:
        defaults["decimals"] = decimals
    if fixed:
        defaults["color"] = {"mode": "fixed", "fixedColor": fixed}
        defaults["thresholds"] = {"mode": "absolute", "steps": steps((fixed, None))}
    else:
        defaults["color"] = {"mode": "thresholds"}
        defaults["thresholds"] = {"mode": "absolute", "steps": steps(*thr)}
    return {
        "id": pid, "title": title, "type": "stat", "datasource": "Prometheus",
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"expr": expr, "instant": True, "legendFormat": "valeur"}],
        "fieldConfig": {"defaults": defaults, "overrides": []},
        "options": {"colorMode": "background", "graphMode": "none", "textMode": text,
                    "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }

def ts(pid, title, targets, x, y, w, h, unit, overrides=None):
    return {
        "id": pid, "title": title, "type": "timeseries", "datasource": "Prometheus",
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"expr": e, "legendFormat": l} for e, l in targets],
        "fieldConfig": {"defaults": {"unit": unit, "custom": {"lineWidth": 2, "fillOpacity": 8}},
                        "overrides": overrides or []},
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}},
    }

SLO_LINE = {"matcher": {"id": "byName", "options": "objectif P95"},
            "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": "red"}},
                           {"id": "custom.lineStyle", "value": {"fill": "dash", "dash": [10, 10]}},
                           {"id": "custom.fillOpacity", "value": 0}]}

panels = [
    stat(1, "SLO 1 — Disponibilité (≥ 99,5 %)",
         f"100 * (1 - ({ERR5} or vector(0)) / {TOTAL})", 0, 0, 5, 4, "percent", 3,
         thr=[("red", None), ("green", 99.5)]),
    stat(2, "SLO 2 — Latence P95 mesurée", q(0.95), 5, 0, 5, 4, "s", 3, fixed="blue"),
    stat(3, "SLO 2 — Latence P99 mesurée", q(0.99), 10, 0, 5, 4, "s", 3, fixed="blue"),
    stat(4, "SLO 3 — Erreurs 5xx (< 0,5 %)",
         f"100 * ({ERR5} or vector(0)) / {TOTAL}", 15, 0, 5, 4, "percent", 3,
         thr=[("green", None), ("red", 0.5)]),
    stat(5, "SLO 4 — Cache hit ratio (> 60 %)",
         f"((100 * {HITS} / ({HITS} + {MISS})) and on() (vector(${{slo_cache}}) == 1))"
         f" or on() (vector(-1) and on() (vector(${{slo_cache}}) == 0))", 20, 0, 4, 4, "percent", 1,
         thr=[("red", None), ("green", 60)], not_evaluated="non évalué (adresses inédites)"),

    stat(6, "Budget de latence P95 consommé — objectif : ${slo_p95}",
         f"100 * {q(0.95)} / ${{slo_p95}}", 0, 4, 8, 4, "percent", 0,
         thr=[("green", None), ("red", 100)]),
    stat(7, "Requêtes /verify sur la fenêtre", TOTAL, 8, 4, 5, 4, "none", 0, fixed="purple"),
    stat(8, "Pods API scrapés (une série par pod)", f'count(up{{{J}}} == 1)', 13, 4, 5, 4, "none", 0, fixed="purple"),
    stat(9, "Débit moyen sur la fenêtre", f"{TOTAL} / ($__range_s)", 18, 4, 6, 4, "reqps", 1, fixed="purple"),

    ts(10, "Latence p50 / p95 / p99 et objectif P95", [
        (f'histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket{{{V}}}[1m])))', "p50"),
        (f'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{{{V}}}[1m])))', "p95"),
        (f'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{{{V}}}[1m])))', "p99"),
        ("vector(${slo_p95})", "objectif P95"),
    ], 0, 8, 12, 9, "s", [SLO_LINE]),
    ts(11, "Débit de requêtes /verify par statut", [
        (f'sum(rate(http_requests_total{{{V}}}[1m])) by (status)', "{{status}}"),
    ], 12, 8, 12, 9, "reqps"),
    ts(12, "Cache : hits vs misses", [
        ("sum(rate(mailguard_cache_hits_total[1m]))", "hits"),
        ("sum(rate(mailguard_cache_misses_total[1m]))", "misses"),
    ], 0, 17, 12, 7, "reqps"),
    ts(13, "Cibles Prometheus saines (pods API)", [
        (f'count(up{{{J}}} == 1)', "pods API up"),
    ], 12, 17, 12, 7, "none"),
]

dash = {
    "title": "MailGuard — SLO", "uid": "mailguard-slo", "timezone": "browser",
    "schemaVersion": 39, "version": 1, "refresh": "", "editable": True,
    "time": {"from": "now-15m", "to": "now"},
    "templating": {"list": [{
        "name": "slo_p95", "label": "Objectif P95 (s)", "type": "custom",
        "query": "nominal (P95 < 200 ms) : 0.2,stress (P95 < 500 ms) : 0.5,spike (aucun SLO de latence) : 60", "hide": 0, "multi": False, "includeAll": False,
        "current": {"selected": True, "text": "nominal (P95 < 200 ms)", "value": "0.2"},
        "options": [{"selected": True, "text": "nominal (P95 < 200 ms)", "value": "0.2"},
                    {"selected": False, "text": "stress (P95 < 500 ms)", "value": "0.5"},
                    {"selected": False, "text": "spike (aucun SLO de latence)", "value": "60"}],
    }, {
        "name": "slo_cache", "label": "SLO cache", "type": "custom",
        "query": "évalué (trafic réel ou scénario cache) : 1,non évalué (adresses inédites - nominal / stress / spike) : 0", "hide": 0, "multi": False, "includeAll": False,
        "current": {"selected": True, "text": "évalué (trafic réel ou scénario cache)", "value": "1"},
        "options": [{"selected": True, "text": "évalué (trafic réel ou scénario cache)", "value": "1"},
                    {"selected": False, "text": "non évalué (adresses inédites - nominal / stress / spike)", "value": "0"}],
    }]},
    "panels": panels,
}

out = ROOT / "monitoring/grafana/dashboards/mailguard-slo.json"
text = json.dumps(dash, indent=2, ensure_ascii=False) + "\n"
out.write_text(text)

# --- insertion dans le ConfigMap k8s/grafana.yaml (idempotent) ---
gy = ROOT / "k8s/grafana.yaml"
src = gy.read_text()
block = "  mailguard-slo.json: |\n" + "".join("    " + l + "\n" if l else "\n" for l in text.rstrip("\n").split("\n"))
src = re.sub(r"  mailguard-slo\.json: \|\n(?:    .*\n|\n)*", "", src)          # retire l'ancienne version
marker = "  mailguard.json: |\n"
start = src.index(marker)
end = src.index("\n---\n", start) + 1                                       # fin du ConfigMap
gy.write_text(src[:end] + block + src[end:])
print("OK:", out.relative_to(ROOT), "et", gy.relative_to(ROOT))
