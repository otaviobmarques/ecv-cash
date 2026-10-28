#!/usr/bin/env bash
# Gera deploy/.env com senhas novas. Uso: ./gerar-env.sh meudominio.com.br meu@email.com
set -euo pipefail
cd "$(dirname "$0")"
[ -e .env ] && { echo "Já existe deploy/.env; não vou sobrescrever (apagaria as senhas do banco em uso)."; exit 1; }
[ $# -eq 2 ] || { echo "Uso: ./gerar-env.sh meudominio.com.br meu@email.com"; exit 1; }
umask 077
cat > .env <<EOF
DOMINIO=$1
EMAIL_ACME=$2
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ECV_OWNER_PW=$(openssl rand -hex 24)
ECV_APP_PW=$(openssl rand -hex 24)
CHAVE_SEGREDOS=$(openssl rand -base64 32)
EOF
echo "Criado deploy/.env. Guarde uma cópia em local seguro (gerenciador de senhas): sem ele não há como recuperar o sistema."
