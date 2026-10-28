#!/usr/bin/env bash
# Gera deploy/.env com senhas novas.
# Uso: ./gerar-env.sh meudominio.com.br NOME_DA_REDE_DO_TRAEFIK NOME_DO_CERTRESOLVER [entrypoint_https] [entrypoint_http]
set -euo pipefail
cd "$(dirname "$0")"
[ -e .env ] && { echo "Já existe deploy/.env; não vou sobrescrever (apagaria as senhas do banco em uso)."; exit 1; }
if [ $# -lt 3 ]; then
  echo "Uso: ./gerar-env.sh meudominio.com.br REDE_TRAEFIK CERTRESOLVER [entrypoint_https] [entrypoint_http]"
  echo "Redes Docker deste servidor:"; docker network ls --format '  {{.Name}}' 2>/dev/null || true
  exit 1
fi
if command -v docker >/dev/null && ! docker network inspect "$2" >/dev/null 2>&1; then
  echo "A rede Docker '$2' não existe neste servidor. Confira com: docker network ls"; exit 1
fi
umask 077
cat > .env <<EOF
DOMINIO=$1
REDE_TRAEFIK=$2
TRAEFIK_CERTRESOLVER=$3
TRAEFIK_ENTRYPOINT_HTTPS=${4:-websecure}
TRAEFIK_ENTRYPOINT_HTTP=${5:-web}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ECV_OWNER_PW=$(openssl rand -hex 24)
ECV_APP_PW=$(openssl rand -hex 24)
CHAVE_SEGREDOS=$(openssl rand -base64 32)
EOF
echo "Criado deploy/.env. Guarde uma cópia em local seguro (gerenciador de senhas): sem ele não há como recuperar o sistema."
