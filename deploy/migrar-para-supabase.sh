#!/usr/bin/env bash
# Copia os DADOS do banco da VPS para o Supabase (o esquema já foi criado lá pelas migrações do deploy da API na Vercel).
# Rodar NA VPS, na pasta deploy/, com a API parada para ninguém gravar no meio da cópia:
#   docker compose stop api site
#   SUPABASE_DB_URL='postgresql://postgres.REF:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' ./migrar-para-supabase.sh
# Use a conexão "Session pooler" (porta 5432) do usuário postgres (Supabase > Connect). A senha é a do banco do projeto.
set -euo pipefail
cd "$(dirname "$0")"
: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (Session pooler, usuário postgres).}"

local_sql() { docker compose exec -T db psql -U postgres -d ecv_cash -XAtq -v ON_ERROR_STOP=1 "$@"; }
remoto_sql() { docker compose exec -T db psql "$SUPABASE_DB_URL" -XAtq -v ON_ERROR_STOP=1 "$@"; }

echo "1/4 Conferindo as migrações dos dois lados..."
ml=$(local_sql -c "SELECT string_agg(nome, ',' ORDER BY nome) FROM schema_migracao")
mr=$(remoto_sql -c "SELECT string_agg(nome, ',' ORDER BY nome) FROM schema_migracao")
if [ "$ml" != "$mr" ]; then
  echo "As migrações não batem. Atualize a VPS (./atualizar.sh) ou faça um deploy de produção da API na Vercel e rode de novo."
  echo "VPS:      $ml"; echo "Supabase: $mr"; exit 1
fi

echo "2/4 Conferindo se o Supabase está vazio..."
[ "$(remoto_sql -c "SELECT count(*) FROM grupo")" = 0 ] && [ "$(remoto_sql -c "SELECT count(*) FROM usuario_interno")" = 0 ] \
  || { echo "O banco do Supabase já tem dados. Para não misturar, a cópia só roda num banco vazio."; exit 1; }

echo "3/4 Copiando os dados (uma transação só: ou vai tudo, ou nada)..."
# replica: não dispara gatilhos (imutabilidade, auditoria) nem confere FKs durante a carga; os dados já eram válidos na origem.
{ echo "SET session_replication_role = replica;"
  docker compose exec -T db pg_dump -U postgres -d ecv_cash --data-only --no-owner --no-privileges \
    --load-via-partition-root --exclude-table=schema_migracao; } \
  | docker compose exec -T db psql "$SUPABASE_DB_URL" -Xq -o /dev/null -v ON_ERROR_STOP=1 --single-transaction

echo "4/4 Comparando a quantidade de linhas tabela a tabela..."
contar='SELECT format($$SELECT %L, count(*) FROM %I$$, c.relname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $$public$$ AND c.relkind IN ($$r$$, $$p$$) AND NOT c.relispartition ORDER BY 1'
diferente=0
while IFS= read -r q; do
  a=$(local_sql -c "$q"); b=$(remoto_sql -c "$q")
  [ "$a" = "$b" ] || { echo "  DIFERENTE: VPS $a | Supabase $b"; diferente=1; }
done < <(local_sql -c "$contar")
[ $diferente = 0 ] && echo "Pronto: todas as tabelas batem." || { echo "Há diferenças acima. Não desligue a VPS e mande esta saída."; exit 1; }
echo
echo "Último passo: na Vercel (projeto ecv-cash-api), troque CHAVE_SEGREDOS pelo valor do deploy/.env desta VPS e faça Redeploy."
echo "Sem isso o 2FA do backoffice não abre (os segredos foram cifrados com a chave daqui)."
