-- Comissão do vistoriador: regras por loja (em % do valor cobrado ou valor fixo por laudo), gravadas em cada laudo no lançamento
-- e fechadas por período, gerando uma conta a pagar por vistoriador.

CREATE TYPE tipo_comissao AS ENUM ('PERCENTUAL', 'VALOR');
CREATE TYPE devida_em AS ENUM ('EMISSAO', 'RECEBIMENTO');
CREATE TYPE status_fechamento_comissao AS ENUM ('FECHADO', 'CANCELADO');

CREATE TABLE regra_comissao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  empresa_id     uuid NOT NULL,
  -- vazio = vale para todos os vistoriadores / todos os serviços
  vistoriador_id uuid,
  servico_id     uuid,
  tipo           tipo_comissao NOT NULL,
  percentual_bp  integer,
  valor_centavos integer,
  devida_em      devida_em NOT NULL DEFAULT 'EMISSAO',
  vigencia_ini   date NOT NULL,
  vigencia_fim   date,
  ativa          boolean NOT NULL DEFAULT true,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (vistoriador_id, grupo_id) REFERENCES vistoriador (id, grupo_id),
  FOREIGN KEY (servico_id, grupo_id)     REFERENCES servico (id, grupo_id),
  CHECK ((tipo = 'PERCENTUAL' AND percentual_bp BETWEEN 1 AND 10000 AND valor_centavos IS NULL) OR (tipo = 'VALOR' AND valor_centavos BETWEEN 1 AND 10000000 AND percentual_bp IS NULL)),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_ini)
);
CREATE INDEX regra_comissao_busca_idx ON regra_comissao (empresa_id, ativa, vigencia_ini);

CREATE TABLE fechamento_comissao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  empresa_id     uuid NOT NULL,
  vistoriador_id uuid NOT NULL,
  periodo_ini    date NOT NULL,
  periodo_fim    date NOT NULL CHECK (periodo_fim >= periodo_ini),
  laudos         integer NOT NULL CHECK (laudos > 0),
  total_centavos bigint NOT NULL CHECK (total_centavos > 0),
  titulo_pagar_id uuid,
  status         status_fechamento_comissao NOT NULL DEFAULT 'FECHADO',
  motivo_cancelamento text,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (vistoriador_id, grupo_id) REFERENCES vistoriador (id, grupo_id),
  FOREIGN KEY (titulo_pagar_id, grupo_id) REFERENCES titulo_pagar (id, grupo_id)
);
CREATE INDEX fechamento_comissao_idx ON fechamento_comissao (empresa_id, criado_em DESC);

-- O que a comissão do laudo era no dia do lançamento: mudança de regra não reescreve o passado.
CREATE TABLE laudo_comissao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  empresa_id     uuid NOT NULL,
  laudo_id       uuid NOT NULL,
  vistoriador_id uuid NOT NULL,
  regra_id       uuid,
  tipo           tipo_comissao NOT NULL,
  percentual_bp  integer,
  valor_regra_centavos integer,
  valor_centavos integer NOT NULL CHECK (valor_centavos >= 0),
  devida_em      devida_em NOT NULL,
  ativo          boolean NOT NULL DEFAULT true,
  fechamento_id  uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (laudo_id, grupo_id)       REFERENCES laudo (id, grupo_id),
  FOREIGN KEY (vistoriador_id, grupo_id) REFERENCES vistoriador (id, grupo_id),
  FOREIGN KEY (regra_id, grupo_id)       REFERENCES regra_comissao (id, grupo_id),
  FOREIGN KEY (fechamento_id, grupo_id)  REFERENCES fechamento_comissao (id, grupo_id)
);
CREATE UNIQUE INDEX laudo_comissao_ativa_uq ON laudo_comissao (laudo_id) WHERE ativo;
CREATE INDEX laudo_comissao_apurar_idx ON laudo_comissao (empresa_id, vistoriador_id) WHERE ativo AND fechamento_id IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['regra_comissao', 'fechamento_comissao', 'laudo_comissao'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON regra_comissao, fechamento_comissao, laudo_comissao TO ecv_app;
