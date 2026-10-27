-- Executar UMA vez por ambiente, como superusuário (ver scripts/db-bootstrap.sh).
-- Papéis:
--   ecv_owner   dono das tabelas; roda as migrações.
--   ecv_app     usado pela API em runtime. Sem BYPASSRLS: toda consulta passa pelo isolamento por grupo.
--   ecv_definer sem login, com BYPASSRLS. Dono só das poucas funções de login que precisam
--               achar usuário e sessão antes de o grupo ser conhecido.
SELECT format('CREATE ROLE ecv_owner LOGIN PASSWORD %L', :'owner_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecv_owner') \gexec
SELECT format('CREATE ROLE ecv_app LOGIN PASSWORD %L NOBYPASSRLS NOSUPERUSER', :'app_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecv_app') \gexec
SELECT 'CREATE ROLE ecv_definer NOLOGIN BYPASSRLS'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecv_definer') \gexec
GRANT ecv_definer TO ecv_owner;

SELECT format('CREATE DATABASE %I OWNER ecv_owner', :'db')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
