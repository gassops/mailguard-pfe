# Contexte de build = racine du repo (pas ./api) — nécessaire pour pouvoir
# copier ml-service/datasets/ ci-dessous (blacklist locale, voir importDomains.js).
# Voir docker-compose.yml (api.build.context) et le build k8s/minikube.

# ── Étape 1 : Build (toutes les dépendances — dev incluses pour les tests) ────
FROM node:20-alpine AS builder

WORKDIR /app

COPY api/package*.json ./
RUN npm install

# ── Étape 2 : Production (dépendances prod uniquement) ───────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY api/package*.json ./
RUN npm install --omit=dev

COPY api/src/ ./src/
COPY api/scripts/ ./scripts/
# Datasets fournis manuellement (voir ml-service/train.py pour l'usage ML) —
# copiés ici pour que importDomains.js puisse alimenter la blacklist MongoDB
# même dans l'image buildée (pas de bind-mount du repo hors docker-compose dev).
COPY ml-service/datasets/ ./datasets/

RUN addgroup -S mailguard && adduser -S mailguard -G mailguard
USER mailguard

EXPOSE 3000

CMD ["node", "src/app.js"]
