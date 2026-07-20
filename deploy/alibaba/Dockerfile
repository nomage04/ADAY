# ADAY (V1) sur Alibaba Cloud ECS : le serveur local FastAPI inchangé,
# lié en loopback uniquement ; seule la passerelle TLS (Caddy) est exposée.
FROM python:3.12-slim

WORKDIR /opt/aday
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY web ./web
COPY config/repository_constraints.json ./config/repository_constraints.json
COPY config/config.example.js ./config/config.example.js

ENV PPTGEN_DATA_DIR=/data/customs
RUN useradd --create-home aday && mkdir -p /data/customs && chown -R aday /data
USER aday

# Pas d'EXPOSE : l'application n'écoute qu'en loopback, la passerelle
# partage son espace réseau.
CMD ["python", "-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", "8000"]
