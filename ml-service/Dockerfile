# ── Stage 1 : installation des dependances ────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# ── Stage 2 : entrainement du modele ──────────────────────────────────────
# Le modele est entraine UNE FOIS au moment du build Docker.
# Le binaire classifier.pkl est ensuite copie dans l'image finale.
# Avantage : l'image est auto-contenue, aucune dependance reseau a l'execution.
FROM python:3.11-slim AS trainer

WORKDIR /app

COPY --from=builder /usr/local /usr/local
COPY train.py requirements.txt ./
COPY datasets/ ./datasets/

ENV PYTHONUNBUFFERED=1
ENV MODEL_PATH=model/classifier.pkl

RUN python train.py

# ── Stage 3 : image de production ─────────────────────────────────────────
FROM python:3.11-slim AS production

WORKDIR /app

# Dependances prod uniquement (installees systeme dans le builder, pas --user,
# pour rester accessibles a l'utilisateur non-root ci-dessous)
COPY --from=builder /usr/local /usr/local
# Code source
COPY app.py train.py ./
# Modele entraine
COPY --from=trainer /app/model ./model

# Utilisateur non-root
RUN addgroup --system mailguard && adduser --system --ingroup mailguard mailguard
USER mailguard

ENV PYTHONUNBUFFERED=1
ENV MODEL_PATH=model/classifier.pkl
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')"

CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "2", \
     "--timeout", "60", \
     "--access-logfile", "-", \
     "app:app"]
