#!/usr/bin/env bash
# Publica a versão mais recente do GitHub. Uso (no servidor): ./deploy/atualizar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main
cd deploy
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
