#!/usr/bin/env bash
# Backup do banco em arquivo comprimido; guarda os últimos 14 dias. Uso: ./deploy/backup.sh [pasta]  (padrão: /var/backups/ecv-cash)
set -euo pipefail
cd "$(dirname "$0")"
pasta="${1:-/var/backups/ecv-cash}"
mkdir -p "$pasta"
arquivo="$pasta/ecv_cash-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U postgres ecv_cash | gzip > "$arquivo"
[ -s "$arquivo" ] || { echo "Backup vazio, algo deu errado."; rm -f "$arquivo"; exit 1; }
find "$pasta" -name 'ecv_cash-*.sql.gz' -mtime +14 -delete
echo "Backup criado: $arquivo"
