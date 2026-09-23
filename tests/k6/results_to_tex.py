#!/usr/bin/env python3
"""Convertit les résultats de la campagne k6 (tests/k6/results/) en macros LaTeX pour le rapport.

Lit, pour chaque scénario, le dernier couple <scénario>_<horodatage>.json (résumé k6) et .txt
(sortie k6 + SLI serveur relevés dans Prometheus), puis écrit chapters/ch6/mesures.tex :
les chiffres du chapitre 6 sont ainsi toujours ceux de la dernière campagne, sans recopie.

Usage : python3 tests/k6/results_to_tex.py [dossier_résultats] [fichier_sortie.tex]
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "results")
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/mg/PFE_Latex/chapters/ch6/mesures.tex"

PREFIX = {"nominal": "Nom", "stress": "Str", "spike": "Spk", "cache": "Cac"}


def fr(x, nd=2):
    return f"{x:.{nd}f}".replace(".", ",")


def ms(v):
    return f"{fr(v)}~ms" if v < 1000 else f"{fr(v / 1000)}~s"


def latest(scn, ext):
    files = sorted(glob.glob(os.path.join(RES, f"{scn}_*.{ext}")))
    return files[-1] if files else None


def server_sli(txt_path):
    """Extrait le bloc « SLI mesurés côté serveur » écrit par run_scenario.sh."""
    if not txt_path:
        return {}
    t = open(txt_path, encoding="utf8").read()
    out = {}
    for key, pat in (("p95", r"latence P95\s*:\s*(\d+) ms"), ("p99", r"latence P99\s*:\s*(\d+) ms"),
                     ("err5", r"erreurs 5xx\s*:\s*([\d.]+) %"), ("avail", r"disponibilité ([\d.]+) %"),
                     ("hit", r"cache hit ratio\s*:\s*([\d.]+) %"), ("hits", r"\((\d+) hits / (\d+)\)"),
                     ("reqs", r"requêtes /verify\s*:\s*(\d+)"), ("pods", r"pods API\s*:\s*(\d+) prêts")):
        m = re.search(pat, t)
        if m:
            out[key] = m.groups() if len(m.groups()) > 1 else m.group(1)
    return out


macros, verdicts, found = [], [], []
for scn, p in PREFIX.items():
    jp = latest(scn, "json")
    if not jp:
        continue
    found.append(scn)
    m = json.load(open(jp, encoding="utf8"))["metrics"]
    d = m["http_req_duration"]
    reqs = m["http_reqs"]
    fl = m["http_req_failed"]
    nfail = int(fl.get("passes", 0))
    ntot = int(reqs["count"])
    rate = float(fl.get("value", nfail / max(ntot, 1)))
    macros += [
        (f"m{p}Req", str(ntot)), (f"m{p}Rate", fr(reqs["rate"], 1)),
        (f"m{p}Avg", ms(d["avg"])), (f"m{p}Med", ms(d["med"])), (f"m{p}Pnine", ms(d["p(90)"])),
        (f"m{p}Pnf", ms(d["p(95)"])), (f"m{p}Pnn", ms(d["p(99)"])), (f"m{p}Max", ms(d["max"])),
        (f"m{p}Err", f"{fr(rate * 100)}~\\%"), (f"m{p}ErrN", str(nfail)),
    ]
    s = server_sli(latest(scn, "txt"))
    if "p95" in s:
        macros += [(f"m{p}SrvPnf", ms(float(s["p95"]))), (f"m{p}SrvPnn", ms(float(s.get("p99", 0))))]
    if "hit" in s:
        macros += [(f"m{p}Hit", f"{fr(float(s['hit']), 1)}~\\%")]
        if "hits" in s:
            macros += [(f"m{p}Hits", s["hits"][0]), (f"m{p}HitTot", s["hits"][1])]
    if "avail" in s:
        macros += [(f"m{p}Avail", f"{fr(float(s['avail']), 3)}~\\%")]
    if "err5" in s:
        macros += [(f"m{p}ErrFive", f"{fr(float(s['err5']), 3)}~\\%")]
    if "pods" in s:
        macros += [(f"m{p}Pods", s["pods"])]

    # verdict des seuils (mêmes objectifs que les scripts k6)
    if scn == "nominal":
        verdicts.append((scn, "p95 < 200 ms", d["p(95)"] < 200)); verdicts.append((scn, "p99 < 500 ms", d["p(99)"] < 500)); verdicts.append((scn, "0 erreur", nfail == 0))
    elif scn == "stress":
        verdicts.append((scn, "p95 < 500 ms", d["p(95)"] < 500)); verdicts.append((scn, "erreurs < 1 %", rate < 0.01))
    elif scn == "spike":
        verdicts.append((scn, "erreurs < 20 %", rate < 0.20))
    elif scn == "cache":
        verdicts.append((scn, "0 erreur", nfail == 0))
        if "hit" in s:
            verdicts.append((scn, "cache hit ratio > 60 %", float(s["hit"]) > 60))

lines = ["% Fichier GÉNÉRÉ par tests/k6/results_to_tex.py — ne pas éditer à la main.",
         f"% Scénarios lus : {', '.join(found) or 'aucun'}", r"\campagnetrue" if found else r"\campagnefalse"]
for k, v in macros:
    lines.append(f"\\renewcommand{{\\{k}}}{{{v}}}")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf8").write("\n".join(lines) + "\n")

print(f"{OUT} : {len(macros)} macros, scénarios {found or 'aucun'}")
bad = [v for v in verdicts if not v[2]]
for scn, name, ok in verdicts:
    print(f"  [{'OK ' if ok else 'ÉCHEC'}] {scn:8s} {name}")
if bad:
    print("\n/!\\ Au moins un objectif n'est pas atteint : le texte du chapitre 6 doit être revu.")
    sys.exit(1)
