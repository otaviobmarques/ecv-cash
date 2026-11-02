-- Royalties e taxas da franquia (regras por loja, apuração mensal que gera conta a pagar) e alíquotas de impostos por loja, com vigência.
-- As alíquotas só alimentam a dedução do DRE: o sistema não apura nem emite imposto.

CREATE TYPE tipo_repasse AS ENUM ('PERCENTUAL', 'VALOR_FIXO');
CREATE TYPE base_repasse AS ENUM ('BRUTO', 'LIQUIDO', 'RECEBIDO');
CREATE TYPE status_apuracao AS ENUM ('APURADO', 'CANCELADO');
CREATE TYPE nome_imposto AS ENUM ('ISS', 'PIS', 'COFINS', 'SIMPLES_NACIONAL', 'OUTRO');

CREATE TABLE regra_repasse (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  empresa_id     uuid NOT NULL,
  fornecedor_id  uuid NOT NULL,
  nome           text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  tipo           tipo_repasse NOT NULL,
  percentual_bp  integer,
  valor_centavos integer,
  base           base_repasse,
  vencimento_dia smallint NOT NULL DEFAULT 10 CHECK (vencimento_dia BETWEEN 1 AND 31),
  plano_conta_id uuid,
  vigencia_ini   date NOT NULL,
  vigencia_fim   date,
  ativa          boolean NOT NULL DEFAULT true,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (fornecedor_id, grupo_id)  REFERENCES fornecedor (id, grupo_id),
  FOREIGN KEY (plano_conta_id, grupo_id) REFERENCES plano_conta (id, grupo_id),
  CHECK ((tipo = 'PERCENTUAL' AND percentual_bp BETWEEN 1 AND 10000 AND valor_centavos IS NULL AND base IS NOT NULL)
      OR (tipo = 'VALOR_FIXO' AND valor_centavos BETWEEN 1 AND 1000000000 AND percentual_bp IS NULL AND base IS NULL)),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_ini)
);

CREATE TABLE repasse_apuracao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id        uuid NOT NULL REFERENCES grupo(id),
  empresa_id      uuid NOT NULL,
  regra_id        uuid NOT NULL,
  mes             date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  base_centavos   bigint NOT NULL,
  valor_centavos  bigint NOT NULL CHECK (valor_centavos > 0),
  titulo_pagar_id uuid,
  status          status_apuracao NOT NULL DEFAULT 'APURADO',
  motivo_cancelamento text,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)      REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (regra_id, grupo_id)        REFERENCES regra_repasse (id, grupo_id),
  FOREIGN KEY (titulo_pagar_id, grupo_id) REFERENCES titulo_pagar (id, grupo_id)
);
CREATE UNIQUE INDEX repasse_apuracao_uq ON repasse_apuracao (regra_id, mes) WHERE status = 'APURADO';

CREATE TABLE aliquota_imposto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid NOT NULL REFERENCES grupo(id),
  empresa_id    uuid NOT NULL,
  nome          nome_imposto NOT NULL,
  descricao     text,
  percentual_bp integer NOT NULL CHECK (percentual_bp BETWEEN 0 AND 10000),
  vigencia_ini  date NOT NULL,
  vigencia_fim  date,
  ativa         boolean NOT NULL DEFAULT true,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_ini),
  CHECK (nome <> 'OUTRO' OR descricao IS NOT NULL),
  EXCLUDE USING gist (empresa_id WITH =, nome WITH =, coalesce(descricao, '') WITH =, daterange(vigencia_ini, coalesce(vigencia_fim, 'infinity'::date), '[]') WITH &&) WHERE (ativa)
);

-- A alíquota gravada não muda: para reajustar, encerre a vigência e cadastre outra.
CREATE FUNCTION aliquota_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.percentual_bp <> OLD.percentual_bp OR NEW.vigencia_ini <> OLD.vigencia_ini OR NEW.nome <> OLD.nome OR NEW.empresa_id <> OLD.empresa_id THEN
    RAISE EXCEPTION 'Alíquota gravada não muda: encerre a vigência e cadastre uma nova.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aliquota_imutavel BEFORE UPDATE ON aliquota_imposto FOR EACH ROW EXECUTE FUNCTION aliquota_imutavel();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['regra_repasse', 'repasse_apuracao', 'aliquota_imposto'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON regra_repasse, repasse_apuracao, aliquota_imposto TO ecv_app;
