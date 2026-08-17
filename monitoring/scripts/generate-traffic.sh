#!/usr/bin/env bash
#
# Génère du trafic réel vers /api/v1/verify pour peupler les dashboards Grafana.
# Utile en démo : lance ce script puis ouvre http://localhost:3001 pour voir
# les graphiques bouger en direct.
#
# Usage :
#   ./generate-traffic.sh                          # 30 requêtes, clé par défaut
#   ./generate-traffic.sh <API_KEY> <NB_REQUETES>  # personnalisé
#
# Pour obtenir une clé API valide :
#   docker exec mailguard-mongo mongosh mailguard --quiet --eval "db.clients.findOne({}).apiKey"

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000/api/v1/verify}"
API_KEY="${1:-${API_KEY:-}}"
COUNT="${2:-30}"

if [ -z "$API_KEY" ]; then
  echo "Erreur : aucune clé API fournie."
  echo "Usage : $0 <API_KEY> [NB_REQUETES]"
  exit 1
fi

DOMAINS=(gmail.com yahoo.com outlook.com yopmail.com mailinator.com hotmail.com protonmail.com)

echo "Envoi de $COUNT requêtes vers $API_URL..."

for i in $(seq 1 "$COUNT"); do
  domain="${DOMAINS[$((RANDOM % ${#DOMAINS[@]}))]}"
  email="user${i}@${domain}"

  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "{\"email\":\"$email\"}")

  echo "[$i/$COUNT] $email → HTTP $status"
  sleep 0.2
done

echo ""
echo "Terminé. Dashboard : http://localhost:3001/d/mailguard-overview"
