#!/usr/bin/env bash
# Copia os DADOS do banco da VPS para o Supabase (o esquema já foi criado lá pelas migrações do deploy da API na Vercel).
# Rodar NA VPS, na pasta deploy/, com a API parada para ninguém gravar no meio da cópia:
#   docker compose stop api site
#   SUPABASE_DB_URL='postgresql://postgres.REF:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' ./migrar-para-supabase.sh
# Use a conexão "Session pooler" (porta 5432) do usuário postgres (Supabase > Connect). A senha é a do banco do projeto.
set -euo pipefail
cd "$(dirname "$0")"
: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (Session pooler, usuário postgres).}"

# </dev/null: sem isso o "docker compose exec" consome a entrada dos laços "while read" abaixo e só a primeira tabela é conferida.
local_sql() { docker compose exec -T db psql -U postgres -d ecv_cash -XAtq -v ON_ERROR_STOP=1 "$@" </dev/null; }
remoto_sql() { docker compose exec -T db psql "$SUPABASE_DB_URL" -XAtq -v ON_ERROR_STOP=1 "$@" </dev/null; }

echo "1/4 Conferindo as migrações dos dois lados..."
ml=$(local_sql -c "SELECT string_agg(nome, ',' ORDER BY nome) FROM schema_migracao")
mr=$(remoto_sql -c "SELECT string_agg(nome, ',' ORDER BY nome) FROM schema_migracao")
if [ "$ml" != "$mr" ]; then
  echo "As migrações não batem. Atualize a VPS (./atualizar.sh) ou faça um deploy de produção da API na Vercel e rode de novo."
  echo "VPS:      $ml"; echo "Supabase: $mr"; exit 1
fi

contar='SELECT format($$SELECT %L, count(*) FROM %I$$, c.relname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $$public$$ AND c.relkind IN ($$r$$, $$p$$) AND NOT c.relispartition AND c.relname <> $$schema_migracao$$ ORDER BY 1'

echo "2/4 Conferindo se o Supabase está vazio (só são aceitos usuários internos criados lá e dados técnicos de login)..."
while IFS= read -r q; do
  r=$(remoto_sql -c "$q")
  case "$r" in usuario_interno\|*|sessao_interna\|*|login_tentativa\|*|*\|0) ;; *) echo "O Supabase já tem dados ($r). Para não misturar, a cópia só roda num banco vazio."; exit 1 ;; esac
done < <(local_sql -c "$contar")

# Usuário interno criado no Supabase com o mesmo e-mail de um da VPS: fica o da VPS (com 2FA e histórico); o de lá sai.
emails_vps=$(local_sql -c "SELECT coalesce(string_agg(quote_literal(lower(email)), ','), \$\$''\$\$) FROM usuario_interno")
trocar="DELETE FROM sessao_interna WHERE usuario_interno_id IN (SELECT id FROM usuario_interno WHERE lower(email) IN ($emails_vps));
DELETE FROM usuario_interno WHERE lower(email) IN ($emails_vps);
-- os que ficam tiveram o 2FA cifrado com a chave do Supabase; com a CHAVE_SEGREDOS da VPS eles configuram o 2FA de novo no próximo login
DELETE FROM sessao_interna;
-- tentativas de login feitas no Supabase (dado técnico): saem para as da VPS entrarem com os mesmos números
DELETE FROM login_tentativa;
UPDATE usuario_interno SET mfa_secret = NULL, mfa_ultimo_passo = NULL;"
echo "   Usuários internos do Supabase que serão trocados pelos da VPS: $(remoto_sql -c "SELECT coalesce(string_agg(email, ', '), 'nenhum') FROM usuario_interno WHERE lower(email) IN ($emails_vps)")"
echo "   Usuários internos do Supabase que ficam: $(remoto_sql -c "SELECT coalesce(string_agg(email, ', '), 'nenhum') FROM usuario_interno WHERE lower(email) NOT IN ($emails_vps)")"

echo "3/4 Copiando os dados (uma transação só: ou vai tudo, ou nada)..."
# replica: não dispara gatilhos (imutabilidade, auditoria) nem confere FKs durante a carga; os dados já eram válidos na origem.
{ echo "SET session_replication_role = replica;"; echo "$trocar"
  docker compose exec -T db pg_dump -U postgres -d ecv_cash --data-only --no-owner --no-privileges \
    --load-via-partition-root --exclude-table=schema_migracao; } \
  | docker compose exec -T db psql "$SUPABASE_DB_URL" -Xq -o /dev/null -v ON_ERROR_STOP=1 --single-transaction

echo "4/4 Comparando a quantidade de linhas tabela a tabela..."
diferente=0
while IFS= read -r q; do
  a=$(local_sql -c "$q"); b=$(remoto_sql -c "$q")
  case "$a" in usuario_interno\|*|sessao_interna\|*) [ "$a" = "$b" ] || echo "  (ok) $b no Supabase, $a na VPS: usuários criados no Supabase continuam."; continue ;; esac
  [ "$a" = "$b" ] || { echo "  DIFERENTE: VPS $a | Supabase $b"; diferente=1; }
done < <(local_sql -c "$contar")
[ $diferente = 0 ] && echo "Pronto: todas as tabelas batem." || { echo "Há diferenças acima. Não desligue a VPS e mande esta saída."; exit 1; }
echo
echo "Se o 2FA do backoffice estiver ligado na Vercel (BO_EXIGIR_2FA diferente de false): troque CHAVE_SEGREDOS no projeto"
echo "ecv-cash-api pelo valor do deploy/.env desta VPS e faça Redeploy. Sem isso o 2FA de quem veio daqui não abre."
