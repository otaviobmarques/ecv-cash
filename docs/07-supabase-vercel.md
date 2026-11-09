# Publicação no Supabase + Vercel

Alternativa à VPS (`deploy/`). O banco fica no Supabase e a API e as duas telas ficam na Vercel. As regras não mudam:
o RLS continua no banco, a API roda como `ecv_app` e as migrações rodam como `ecv_owner`.

| Peça | Onde | Observação |
|---|---|---|
| Banco | Supabase `ecv-cash` (sa-east-1) | Papéis `ecv_owner`, `ecv_app` e `ecv_definer`, criados uma vez (ver "Banco novo"). A Data API (PostgREST) não enxerga o esquema `public`. |
| API | Vercel `ecv-cash-api` (raiz `apps/api`) | Function `api/index.js` → `dist/serverless.js`. O deploy de **produção** roda as migrações. |
| Sistema | Vercel `ecv-cash-app` (raiz `apps/web`) | `/api/*` é reescrito para a API: mesmo domínio, cookie de sessão sem CORS. |
| Backoffice | Vercel `ecv-cash-admin` (raiz `apps/backoffice`) | Mesmo esquema do sistema. |
| Rotina diária | Vercel Cron → `GET /interno/agendador` às 11h UTC (8h de Brasília) | Protegida por `CRON_SECRET`. Na Vercel o `setInterval` do agendador fica desligado. |

## Variáveis da API (Vercel)
`DATABASE_URL` (pooler do Supabase em **modo transação**, porta 6543, usuário `ecv_app.<ref>`, `?sslmode=require&uselibpqcompat=true`),
`DATABASE_URL_OWNER` (pooler em **modo sessão**, porta 5432, usuário `ecv_owner.<ref>`, usado só no build para migrar),
`NODE_ENV=production`, `CHAVE_SEGREDOS` (**a mesma da VPS** se os dados vieram de lá), `CRON_SECRET`, `PG_POOL_MAX=3`,
`ORIGENS_PERMITIDAS`, `URL_APP`, `URL_BACKOFFICE`, `EXPOR_CONVITE`, `TRUST_PROXY_SALTOS=1` e as de SMTP e PIX, como na VPS.
Nas telas: `VITE_API_URL=/api`.

## Banco novo (uma vez, no SQL Editor do Supabase)
```sql
CREATE ROLE ecv_owner LOGIN PASSWORD '...';
CREATE ROLE ecv_app LOGIN PASSWORD '...' NOBYPASSRLS NOSUPERUSER;
CREATE ROLE ecv_definer NOLOGIN BYPASSRLS;
GRANT ecv_definer TO ecv_owner;
GRANT ecv_owner TO postgres;
GRANT ALL ON SCHEMA public TO ecv_owner WITH GRANT OPTION;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;  -- o ECV Cash não usa a Data API
```

## Trazer os dados da VPS
Depois do primeiro deploy de produção da API (que cria o esquema), rode na VPS `deploy/migrar-para-supabase.sh`
(as instruções estão no topo do arquivo). Ele confere se as migrações batem, se o destino está vazio, copia tudo numa
transação só e compara a quantidade de linhas de cada tabela. Depois troque o `CHAVE_SEGREDOS` da Vercel pelo da VPS.

## Limites da Vercel
- Upload de no máximo 4,5 MB por requisição (o sistema aceita até 5 MB em anexos e planilhas). Arquivos maiores que isso falham na Vercel.
- A Function tem até 300 s por requisição. A rotina diária roda dentro desse limite.
