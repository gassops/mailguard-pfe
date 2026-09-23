#!/usr/bin/env bash
# À exécuter SUR TON PC. Génère out/mailguard-aws.yaml à partir des manifestes de k8s/ (non modifiés)
# en appliquant exactement les changements nécessaires à un déploiement k3s sur EC2 :
#   1. images       : mailguard-*:latest (construites localement dans minikube)
#                     -> ghcr.io/<propriétaire>/mailguard-*:<tag>   (IMAGE_SOURCE=ghcr, défaut)
#                     ou inchangées si importées à la main dans k3s   (IMAGE_SOURCE=local)
#   2. Ingress      : classe nginx -> traefik (fournie avec k3s), hôte mailguard.local retiré
#                     (l'application répond alors sur l'IP publique)
#   3. Secret       : NOUVEAU mot de passe Grafana aléatoire (celui de ton environnement local
#                     n'est jamais réutilisé) ; MONGO_URI repris de k8s/secrets.yaml (sans identifiants)
#
# Usage :
#   IMAGE_TAG=<sha-du-commit> deploy/aws-k3s/render.sh        # images ghcr.io (recommandé)
#   IMAGE_SOURCE=local        deploy/aws-k3s/render.sh        # images importées à la main
# Variables : GHCR_OWNER (défaut gassops), OUT_DIR (défaut deploy/aws-k3s/out)
#   Dimensionnement de l'API — les manifestes de k8s/ visent un poste à 4 cœurs (4 réplicas minimum,
#   250m CPU demandés, 1 CPU max). Une petite instance (2 vCPU) est réglée par défaut sur
#   2 réplicas, 100m et 500m ; pour une machine plus grande :
#   API_MIN_REPLICAS=4 API_CPU_REQUEST=250m API_CPU_LIMIT=1000m deploy/aws-k3s/render.sh
#
# Le fichier généré contient le mot de passe Grafana en clair : il est ignoré par git (out/).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$HERE/out}"
OWNER="${GHCR_OWNER:-gassops}"
IMAGE_SOURCE="${IMAGE_SOURCE:-ghcr}"
IMAGE_TAG="${IMAGE_TAG:-}"

if [ "$IMAGE_SOURCE" = "ghcr" ] && [ -z "$IMAGE_TAG" ]; then
  echo "IMAGE_TAG manquant : indique le SHA du commit dont la CI a publié les images (git rev-parse HEAD)." >&2
  exit 2
fi
command -v python3 >/dev/null || { echo "python3 requis" >&2; exit 2; }
python3 -c "import yaml" 2>/dev/null || { echo "PyYAML requis : pip install pyyaml" >&2; exit 2; }

mkdir -p "$OUT_DIR"

python3 - "$ROOT" "$OUT_DIR" "$OWNER" "$IMAGE_SOURCE" "$IMAGE_TAG" <<'PY'
import os, re, secrets, sys
import yaml

root, out_dir, owner, source, tag = sys.argv[1:6]
k8s = os.path.join(root, "k8s")
api_min     = os.environ.get("API_MIN_REPLICAS", "2")
api_cpu_req = os.environ.get("API_CPU_REQUEST", "100m")
api_cpu_lim = os.environ.get("API_CPU_LIMIT", "500m")

# Ordre d'application : namespace d'abord, puis configuration, données, applications, exposition, observabilité.
ORDER = ["namespace", "configmap", "@secret", "mongo-pvc", "mongo-deployment", "redis-deployment",
         "ml-deployment", "api-deployment", "frontend-deployment", "services", "hpa", "ingress",
         "prometheus", "alertmanager", "grafana"]

# --- Secret : mot de passe Grafana neuf ; MONGO_URI repris du dépôt (pas d'identifiants dedans) ---
src_secret = yaml.safe_load(open(os.path.join(k8s, "secrets.yaml"), encoding="utf8"))
grafana_pwd = secrets.token_urlsafe(18)
secret = f"""apiVersion: v1
kind: Secret
metadata:
  name: {src_secret['metadata']['name']}
  namespace: {src_secret['metadata']['namespace']}
type: Opaque
stringData:
  MONGO_URI: "{src_secret['stringData']['MONGO_URI']}"
  GF_ADMIN_PASSWORD: "{grafana_pwd}"
"""

parts = []
for name in ORDER:
    if name == "@secret":
        parts.append(secret)
        continue
    text = open(os.path.join(k8s, f"{name}.yaml"), encoding="utf8").read()

    if source == "ghcr":
        for comp in ("api", "ml", "frontend"):
            text = text.replace(f"image: mailguard-{comp}:latest", f"image: ghcr.io/{owner}/mailguard-{comp}:{tag}")

    if name == "api-deployment":
        for old, new in (("cpu: 250m", f"cpu: {api_cpu_req}"), ("cpu: 1000m", f"cpu: {api_cpu_lim}"),
                         ("replicas: 4", f"replicas: {api_min}")):
            assert text.count(old) == 1, f"api-deployment : motif « {old} » introuvable ou multiple"
            text = text.replace(old, new)
    if name == "hpa":
        assert text.count("minReplicas: 4") == 1, "hpa : motif minReplicas introuvable"
        text = text.replace("minReplicas: 4", f"minReplicas: {api_min}")

    if name == "ingress":
        text = text.replace("ingressClassName: nginx", "ingressClassName: traefik")
        text, n = re.subn(r"- host: mailguard\.local\n\s+http:", "- http:", text)
        assert n == 1, "structure de l'Ingress inattendue : le retrait de l'hôte a échoué"
    parts.append(text)

rendered = ("# GÉNÉRÉ par deploy/aws-k3s/render.sh — ne pas éditer à la main, ne pas commiter (contient un secret).\n"
            + "\n---\n".join(p.strip("\n") for p in parts) + "\n")

# --- Contrôles : YAML valide, transformations réellement appliquées, aucun reste de l'environnement local ---
docs = [d for d in yaml.safe_load_all(rendered) if d]
kinds = [d["kind"] for d in docs]
assert docs[0]["kind"] == "Namespace", "le Namespace doit venir en premier"
assert "ghcr" != source or "image: mailguard-" not in rendered, "une image locale n'a pas été remplacée"
assert "ingressClassName: nginx" not in rendered and "mailguard.local" not in re.sub(r"#.*", "", rendered)
ing = next(d for d in docs if d["kind"] == "Ingress")
assert ing["spec"]["ingressClassName"] == "traefik" and "host" not in ing["spec"]["rules"][0]

out = os.path.join(out_dir, "mailguard-aws.yaml")
open(out, "w", encoding="utf8").write(rendered)
pwd_file = os.path.join(out_dir, ".grafana-password")
open(pwd_file, "w").write(grafana_pwd + "\n")
os.chmod(pwd_file, 0o600)
os.chmod(out, 0o600)

imgs = sorted({c["image"] for d in docs if d["kind"] == "Deployment"
               for c in d["spec"]["template"]["spec"]["containers"] if "mailguard" in c["image"]})
print(f"OK : {out}")
print(f"  {len(docs)} ressources : " + ", ".join(f"{k}×{kinds.count(k)}" for k in dict.fromkeys(kinds)))
print("  images MailGuard : " + ", ".join(imgs))
hpa = next(d for d in docs if d["kind"] == "HorizontalPodAutoscaler")
print(f"  API : {api_min} à {hpa['spec']['maxReplicas']} réplicas, CPU {api_cpu_req} demandés / {api_cpu_lim} max")
print(f"  Mot de passe Grafana (utilisateur admin) : {grafana_pwd}   (copie : {pwd_file})")
PY
