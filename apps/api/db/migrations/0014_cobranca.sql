-- Cobrança por e-mail: régua por loja (lembrete antes do vencimento e avisos de atraso) e o registro de tudo o que foi enviado ou tentado.

CREATE TYPE tipo_email AS ENUM ('FATURA', 'LEMBRETE', 'ATRASO', 'MANUAL');
CREATE TYPE status_email AS ENUM ('PENDENTE', 'ENVIADO', 'ERRO', 'SEM_CONFIGURACAO', 'SEM_DESTINATARIO');

CREATE TABLE regua_cobranca (
  empresa_id      uuid PRIMARY KEY,
  grupo_id        uuid NOT NULL REFERENCES grupo(id),
  -- desligada por padrão: ninguém recebe e-mail antes de a loja decidir
  ativa           boolean NOT NULL DEFAULT false,
  enviar_ao_gerar boolean NOT NULL DEFAULT true,
  -- quantos dias antes do vencimento mandar lembrete, e quantos dias depois mandar aviso de atraso
  dias_antes      smallint[] NOT NULL DEFAULT '{3}',
  dias_apos       smallint[] NOT NULL DEFAULT '{1,7,15}',
  copia_para      text,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  CHECK (cardinality(dias_antes) <= 5 AND cardinality(dias_apos) <= 5)
);

CREATE TABLE envio_email (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id     uuid NOT NULL REFERENCES grupo(id),
  empresa_id   uuid NOT NULL,
  fatura_id    uuid NOT NULL,
  cliente_id   uuid NOT NULL,
  tipo         tipo_email NOT NULL,
  -- dias antes (lembrete) ou depois (atraso) do vencimento em que este aviso sai; 0 nos demais
  dias         smallint NOT NULL DEFAULT 0,
  automatico   boolean NOT NULL DEFAULT false,
  para         text[] NOT NULL,
  assunto      text NOT NULL,
  status       status_email NOT NULL DEFAULT 'PENDENTE',
  erro         text,
  criado_por   uuid,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  enviado_em   timestamptz,
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (fatura_id, grupo_id)  REFERENCES fatura (id, grupo_id),
  FOREIGN KEY (cliente_id, grupo_id) REFERENCES cliente (id, grupo_id)
);
-- a régua nunca manda o mesmo aviso duas vezes para a mesma fatura
CREATE UNIQUE INDEX envio_email_automatico_uq ON envio_email (fatura_id, tipo, dias) WHERE automatico;
CREATE INDEX envio_email_empresa_idx ON envio_email (empresa_id, criado_em DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['regua_cobranca', 'envio_email'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON regua_cobranca, envio_email TO ecv_app;
