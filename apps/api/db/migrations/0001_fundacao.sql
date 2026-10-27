-- Fundação: grupos, empresas, usuários, perfis por loja, tema, arquivos, sessão e auditoria.
-- Convenções: UUID em tudo; nada é excluído (status/cancelamento); toda tabela de negócio leva grupo_id
-- e chaves estrangeiras compostas (id, grupo_id) para que dados de grupos diferentes nunca se misturem.

CREATE TYPE perfil_loja       AS ENUM ('GERENTE', 'FINANCEIRO', 'VISTORIADOR');
CREATE TYPE status_grupo      AS ENUM ('ATIVO', 'SUSPENSO', 'ENCERRADO');
CREATE TYPE status_cadastro   AS ENUM ('ATIVO', 'INATIVO');
CREATE TYPE regime_tributario AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');
CREATE TYPE papel_interno     AS ENUM ('PLATAFORMA', 'OPERACOES', 'SUPORTE');

CREATE FUNCTION touch_atualizado_em() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END $$;

CREATE TABLE grupo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  status        status_grupo NOT NULL DEFAULT 'ATIVO',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE empresa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  cnpj           char(14) NOT NULL UNIQUE CHECK (cnpj ~ '^[0-9]{14}$'),
  razao_social   text NOT NULL,
  nome_fantasia  text NOT NULL,
  uf             char(2) NOT NULL,
  cidade         text NOT NULL,
  regime         regime_tributario NOT NULL,
  email_financeiro text,
  status         status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id)
);
CREATE INDEX empresa_grupo_idx ON empresa (grupo_id);

CREATE TABLE usuario (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          uuid NOT NULL REFERENCES grupo(id),
  nome              text NOT NULL,
  email             text NOT NULL,
  senha_hash        text,
  convite_hash      bytea,
  convite_expira_em timestamptz,
  -- true = Administrativo da rede: enxerga todas as empresas do grupo
  acesso_rede       boolean NOT NULL DEFAULT false,
  status            status_cadastro NOT NULL DEFAULT 'ATIVO',
  mfa_secret        text,
  ultimo_login_em   timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  CHECK (senha_hash IS NOT NULL OR convite_hash IS NOT NULL)
);
CREATE UNIQUE INDEX usuario_email_uq ON usuario (lower(email));
CREATE INDEX usuario_grupo_idx ON usuario (grupo_id);
CREATE UNIQUE INDEX usuario_convite_uq ON usuario (convite_hash) WHERE convite_hash IS NOT NULL;

CREATE TABLE usuario_empresa_perfil (
  usuario_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  grupo_id   uuid NOT NULL,
  perfil     perfil_loja NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, empresa_id),
  FOREIGN KEY (usuario_id, grupo_id) REFERENCES usuario (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id)
);
CREATE INDEX uep_empresa_idx ON usuario_empresa_perfil (empresa_id);

CREATE TABLE arquivo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid NOT NULL REFERENCES grupo(id),
  tipo          text NOT NULL,
  storage_key   text NOT NULL UNIQUE,
  mime          text NOT NULL,
  tamanho_bytes integer NOT NULL CHECK (tamanho_bytes > 0),
  sha256        text NOT NULL,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id)
);

-- Tema do cliente: empresa_id nulo = tema do grupo. A empresa herda o do grupo se não tiver o próprio.
CREATE TABLE tema (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  empresa_id     uuid,
  logo_claro_id  uuid,
  logo_escuro_id uuid,
  cor_primaria   char(7) NOT NULL CHECK (cor_primaria ~ '^#[0-9A-F]{6}$'),
  cor_secundaria char(7) CHECK (cor_secundaria ~ '^#[0-9A-F]{6}$'),
  cor_destaque   char(7) CHECK (cor_destaque ~ '^#[0-9A-F]{6}$'),
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id)    REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (logo_claro_id, grupo_id) REFERENCES arquivo (id, grupo_id),
  FOREIGN KEY (logo_escuro_id, grupo_id) REFERENCES arquivo (id, grupo_id)
);
CREATE UNIQUE INDEX tema_escopo_uq
  ON tema (grupo_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE sessao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       bytea NOT NULL UNIQUE,
  usuario_id       uuid NOT NULL,
  grupo_id         uuid NOT NULL,
  empresa_ativa_id uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  expira_em        timestamptz NOT NULL,
  revogada_em      timestamptz,
  ip               inet,
  user_agent       text,
  FOREIGN KEY (usuario_id, grupo_id) REFERENCES usuario (id, grupo_id),
  FOREIGN KEY (empresa_ativa_id, grupo_id) REFERENCES empresa (id, grupo_id)
);
CREATE INDEX sessao_usuario_idx ON sessao (usuario_id);

-- Controle de força bruta no login. Sem dado pessoal em claro: a chave é o hash do e-mail.
CREATE TABLE login_tentativa (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave     text NOT NULL,
  ip        inet,
  sucesso   boolean NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_tentativa_chave_idx ON login_tentativa (chave, criado_em DESC);

-- Auditoria: só inserção, particionada por mês.
CREATE TABLE auditoria_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY,
  grupo_id           uuid NOT NULL REFERENCES grupo(id),
  empresa_id         uuid,
  usuario_id         uuid,
  usuario_interno_id uuid,
  acao               text NOT NULL,
  entidade           text NOT NULL,
  entidade_id        text,
  antes              jsonb,
  depois             jsonb,
  motivo             text,
  ip                 inet,
  user_agent         text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, criado_em)
) PARTITION BY RANGE (criado_em);
CREATE INDEX auditoria_grupo_idx   ON auditoria_log (grupo_id, criado_em DESC);
CREATE INDEX auditoria_entidade_idx ON auditoria_log (grupo_id, entidade, entidade_id);

CREATE TABLE auditoria_log_default PARTITION OF auditoria_log DEFAULT;

CREATE FUNCTION auditoria_criar_particao(p_ano int, p_mes int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ini date := make_date(p_ano, p_mes, 1);
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF auditoria_log FOR VALUES FROM (%L) TO (%L)',
                 format('auditoria_log_%s_%s', p_ano, lpad(p_mes::text, 2, '0')), ini, ini + interval '1 month');
END $$;

SELECT auditoria_criar_particao(extract(year FROM d)::int, extract(month FROM d)::int)
  FROM generate_series(date '2026-01-01', date '2027-12-01', interval '1 month') AS d;

CREATE FUNCTION auditoria_somente_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'auditoria_log é somente inserção'; END $$;
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria_log
  FOR EACH ROW EXECUTE FUNCTION auditoria_somente_insercao();

-- Equipe interna (backoffice). Sem isolamento por grupo: nunca mistura com os usuários dos clientes.
CREATE TABLE usuario_interno (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  email      text NOT NULL,
  senha_hash text NOT NULL,
  papel      papel_interno NOT NULL,
  mfa_secret text,
  status     status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuario_interno_email_uq ON usuario_interno (lower(email));

CREATE TABLE sessao_suporte (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_interno_id uuid NOT NULL REFERENCES usuario_interno(id),
  grupo_id           uuid NOT NULL REFERENCES grupo(id),
  motivo             text NOT NULL CHECK (length(motivo) >= 10),
  inicio             timestamptz NOT NULL DEFAULT now(),
  expira_em          timestamptz NOT NULL,
  encerrada_em       timestamptz
);

CREATE TRIGGER grupo_touch   BEFORE UPDATE ON grupo   FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
CREATE TRIGGER empresa_touch BEFORE UPDATE ON empresa FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
CREATE TRIGGER usuario_touch BEFORE UPDATE ON usuario FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
