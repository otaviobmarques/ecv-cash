-- Isolamento por grupo e por loja (RLS) e as funções de login.
-- A API informa o contexto por transação com set_config(...). Sem contexto, nenhuma linha é visível.

CREATE FUNCTION app_grupo_id()   RETURNS uuid    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.grupo_id', true), '')::uuid $$;
CREATE FUNCTION app_usuario_id() RETURNS uuid    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;
CREATE FUNCTION app_rede()       RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.rede', true) = 'on', false) $$;
CREATE FUNCTION app_empresas()   RETURNS uuid[]  LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.empresas', true), ''), ',')::uuid[], '{}'::uuid[]) $$;

-- Tabelas de negócio: RLS ligada e FORÇADA (vale até para o dono das tabelas).
ALTER TABLE grupo                  ENABLE ROW LEVEL SECURITY; ALTER TABLE grupo                  FORCE ROW LEVEL SECURITY;
ALTER TABLE empresa                ENABLE ROW LEVEL SECURITY; ALTER TABLE empresa                FORCE ROW LEVEL SECURITY;
ALTER TABLE usuario                ENABLE ROW LEVEL SECURITY; ALTER TABLE usuario                FORCE ROW LEVEL SECURITY;
ALTER TABLE usuario_empresa_perfil ENABLE ROW LEVEL SECURITY; ALTER TABLE usuario_empresa_perfil FORCE ROW LEVEL SECURITY;
ALTER TABLE arquivo                ENABLE ROW LEVEL SECURITY; ALTER TABLE arquivo                FORCE ROW LEVEL SECURITY;
ALTER TABLE tema                   ENABLE ROW LEVEL SECURITY; ALTER TABLE tema                   FORCE ROW LEVEL SECURITY;
ALTER TABLE sessao                 ENABLE ROW LEVEL SECURITY; ALTER TABLE sessao                 FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria_log          ENABLE ROW LEVEL SECURITY; ALTER TABLE auditoria_log          FORCE ROW LEVEL SECURITY;

CREATE POLICY grupo_tenant ON grupo
  USING (id = app_grupo_id()) WITH CHECK (id = app_grupo_id());

CREATE POLICY empresa_tenant ON empresa
  USING (grupo_id = app_grupo_id() AND (app_rede() OR id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR id = ANY (app_empresas())));

CREATE POLICY usuario_sel ON usuario FOR SELECT
  USING (grupo_id = app_grupo_id() AND (
    app_rede() OR id = app_usuario_id() OR EXISTS (
      SELECT 1 FROM usuario_empresa_perfil p WHERE p.usuario_id = usuario.id AND p.empresa_id = ANY (app_empresas()))));
CREATE POLICY usuario_ins ON usuario FOR INSERT WITH CHECK (grupo_id = app_grupo_id());
CREATE POLICY usuario_upd ON usuario FOR UPDATE
  USING (grupo_id = app_grupo_id() AND (
    app_rede() OR id = app_usuario_id() OR EXISTS (
      SELECT 1 FROM usuario_empresa_perfil p WHERE p.usuario_id = usuario.id AND p.empresa_id = ANY (app_empresas()))))
  WITH CHECK (grupo_id = app_grupo_id());

-- O usuário sempre enxerga as próprias lotações (necessário no login, quando as lojas ainda não são conhecidas).
CREATE POLICY uep_sel ON usuario_empresa_perfil FOR SELECT
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas()) OR usuario_id = app_usuario_id()));
CREATE POLICY uep_mod ON usuario_empresa_perfil FOR ALL
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));

CREATE POLICY arquivo_tenant ON arquivo
  USING (grupo_id = app_grupo_id()) WITH CHECK (grupo_id = app_grupo_id());

CREATE POLICY tema_sel ON tema FOR SELECT
  USING (grupo_id = app_grupo_id() AND (empresa_id IS NULL OR app_rede() OR empresa_id = ANY (app_empresas())));
CREATE POLICY tema_mod ON tema FOR ALL
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));

CREATE POLICY sessao_propria ON sessao
  USING (grupo_id = app_grupo_id() AND usuario_id = app_usuario_id())
  WITH CHECK (grupo_id = app_grupo_id() AND usuario_id = app_usuario_id());

CREATE POLICY auditoria_sel ON auditoria_log FOR SELECT
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
CREATE POLICY auditoria_ins ON auditoria_log FOR INSERT WITH CHECK (grupo_id = app_grupo_id());

-- Funções de login: rodam com o dono ecv_definer (BYPASSRLS) porque precisam achar o usuário e a sessão
-- antes de o grupo ser conhecido. Cada uma devolve só o necessário.
CREATE FUNCTION auth_buscar_usuario(p_email text)
RETURNS TABLE (id uuid, grupo_id uuid, nome text, email text, senha_hash text, acesso_rede boolean,
               status status_cadastro, grupo_status status_grupo)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.grupo_id, u.nome, u.email, u.senha_hash, u.acesso_rede, u.status, g.status
    FROM usuario u JOIN grupo g ON g.id = u.grupo_id
   WHERE lower(u.email) = lower(p_email) $$;

CREATE FUNCTION auth_buscar_sessao(p_token_hash bytea)
RETURNS TABLE (sessao_id uuid, usuario_id uuid, grupo_id uuid, empresa_ativa_id uuid, acesso_rede boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.usuario_id, s.grupo_id, s.empresa_ativa_id, u.acesso_rede
    FROM sessao s
    JOIN usuario u ON u.id = s.usuario_id AND u.grupo_id = s.grupo_id AND u.status = 'ATIVO'
    JOIN grupo g   ON g.id = s.grupo_id AND g.status = 'ATIVO'
   WHERE s.token_hash = p_token_hash AND s.revogada_em IS NULL AND s.expira_em > now() $$;

CREATE FUNCTION auth_buscar_convite(p_convite_hash bytea)
RETURNS TABLE (id uuid, grupo_id uuid, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.grupo_id, u.email FROM usuario u
   WHERE u.convite_hash = p_convite_hash AND u.convite_expira_em > now() AND u.status = 'ATIVO' $$;

-- Trocar o dono exige que o novo dono possa criar no esquema; a permissão é retirada logo depois.
GRANT CREATE ON SCHEMA public TO ecv_definer;
ALTER FUNCTION auth_buscar_usuario(text)   OWNER TO ecv_definer;
ALTER FUNCTION auth_buscar_sessao(bytea)   OWNER TO ecv_definer;
ALTER FUNCTION auth_buscar_convite(bytea)  OWNER TO ecv_definer;
REVOKE CREATE ON SCHEMA public FROM ecv_definer;
REVOKE ALL ON FUNCTION auth_buscar_usuario(text), auth_buscar_sessao(bytea), auth_buscar_convite(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_buscar_usuario(text), auth_buscar_sessao(bytea), auth_buscar_convite(bytea) TO ecv_app;

-- Permissões mínimas. Não há DELETE em tabela de negócio, só em lotação de usuário e tentativas de login.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ecv_app, ecv_definer;
GRANT SELECT, INSERT, UPDATE ON grupo, empresa, usuario, arquivo, tema, sessao TO ecv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuario_empresa_perfil TO ecv_app;
GRANT SELECT, INSERT ON auditoria_log TO ecv_app;
GRANT SELECT, INSERT, DELETE ON login_tentativa TO ecv_app;
GRANT SELECT, INSERT, UPDATE ON usuario_interno, sessao_suporte TO ecv_app;
GRANT SELECT ON usuario, grupo, sessao TO ecv_definer;
