#!/usr/bin/env bash
# À exécuter SUR l'instance EC2 (Ubuntu 24.04), avec un utilisateur normal disposant de sudo.
#
# Installe k3s (Kubernetes léger) EN GARDANT ses composants intégrés dont MailGuard a besoin :
#   - Traefik        : Ingress (remplace ingress-nginx de minikube)
#   - metrics-server : indispensable au HPA
#   - local-path     : classe de stockage par défaut (volume MongoDB)
#
# Usage (depuis ton PC) :
#   scp -i ~/mailguard-key.pem deploy/aws-k3s/install-k3s.sh ubuntu@<IP_PUBLIQUE>:~
#   ssh -i ~/mailguard-key.pem ubuntu@<IP_PUBLIQUE> 'bash install-k3s.sh'
set -euo pipefail

MEM_MB=$(free -m | awk '/^Mem:/ {print $2}')
echo ">>> Mémoire de la machine : ${MEM_MB} Mo"
if [ "$MEM_MB" -lt 3500 ]; then
  echo "/!\\ Moins de 4 Go de RAM : la stack complète (API, ML, Mongo, Grafana...) risque de ne pas tenir." >&2
fi

echo ">>> Installation de k3s"
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
grep -q 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml' ~/.bashrc 2>/dev/null || \
  echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> ~/.bashrc

echo ">>> Attente du nœud"
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl get nodes -o wide

echo ">>> Attente de Traefik et de metrics-server"
kubectl -n kube-system rollout status deploy/traefik --timeout=240s || echo "(Traefik pas encore prêt : relance 'kubectl -n kube-system get pods')"
kubectl -n kube-system rollout status deploy/metrics-server --timeout=240s || echo "(metrics-server pas encore prêt)"

echo ">>> IngressClass disponibles (attendu : traefik)"
kubectl get ingressclass
echo ">>> Classe de stockage par défaut (attendu : local-path)"
kubectl get storageclass

echo
echo "k3s est prêt. Étape suivante : voir deploy/aws-k3s/README.md, section « Déployer MailGuard »."
