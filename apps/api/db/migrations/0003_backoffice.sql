-- Backoffice: sessão da equipe interna, 2FA com proteção contra reuso de código, acesso de suporte com ticket de uso único.

ALTER TABLE usuario_interno ADD COLUMN mfa_ultimo_passo bigint;

CREATE TABLE sessao_interna (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash         bytea NOT NULL UNIQUE,
  usuario_interno_id uuid NOT NULL REFERENCES usuario_interno(id),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  expira_em          timestamptz NOT NULL,
  revogada_em        timestamptz,
  ip                 inet,
  user_agent         text
);

-- O "entrar como" gera um ticket de uso único; ao trocá-lo nasce uma sessão curta ligada a este registro.
ALTER TABLE sessao_suporte ADD COLUMN ticket_hash bytea UNIQUE;
ALTER TABLE sessao_suporte ADD COLUMN ticket_usado_em timestamptz;
ALTER TABLE sessao ADD COLUMN sessao_suporte_id uuid REFERENCES sessao_suporte(id);

-- A lista de grupos atravessa todos os clientes, então roda com o dono ecv_definer (BYPASSRLS) e devolve só contagens.
CREATE FUNCTION bo_listar_grupos()
RETURNS TABLE (id uuid, nome text, status status_grupo, criado_em timestamptz, empresas bigint, usuarios bigint, ultimo_acesso timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.id, g.nome, g.status, g.criado_em,
         (SELECT count(*) FROM empresa e WHERE e.grupo_id = g.id),
         (SELECT count(*) FROM usuario u WHERE u.grupo_id = g.id AND u.status = 'ATIVO'),
         (SELECT max(u.ultimo_login_em) FROM usuario u WHERE u.grupo_id = g.id)
    FROM grupo g ORDER BY g.criado_em DESC $$;

-- auth_buscar_sessao passa a informar se a sessão é de suporte
DROP FUNCTION auth_buscar_sessao(bytea);
CREATE FUNCTION auth_buscar_sessao(p_token_hash bytea)
RETURNS TABLE (sessao_id uuid, usuario_id uuid, grupo_id uuid, empresa_ativa_id uuid, acesso_rede boolean, sessao_suporte_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.usuario_id, s.grupo_id, s.empresa_ativa_id, u.acesso_rede, s.sessao_suporte_id
    FROM sessao s
    JOIN usuario u ON u.id = s.usuario_id AND u.grupo_id = s.grupo_id AND u.status = 'ATIVO'
    JOIN grupo g   ON g.id = s.grupo_id AND g.status = 'ATIVO'
   WHERE s.token_hash = p_token_hash AND s.revogada_em IS NULL AND s.expira_em > now() $$;

GRANT SELECT ON empresa TO ecv_definer;
GRANT CREATE ON SCHEMA public TO ecv_definer;
ALTER FUNCTION bo_listar_grupos()        OWNER TO ecv_definer;
ALTER FUNCTION auth_buscar_sessao(bytea) OWNER TO ecv_definer;
REVOKE CREATE ON SCHEMA public FROM ecv_definer;
REVOKE ALL ON FUNCTION bo_listar_grupos(), auth_buscar_sessao(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bo_listar_grupos(), auth_buscar_sessao(bytea) TO ecv_app;

GRANT SELECT, INSERT, UPDATE ON sessao_interna TO ecv_app;
