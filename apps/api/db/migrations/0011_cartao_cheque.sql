-- Cartão e cheque. A baixa com cartão não entra no caixa na hora: a operadora paga depois, com desconto da taxa (e da antecipação).
-- A baixa com cheque também não: o dinheiro só entra quando o cheque compensa.

CREATE TYPE status_liquidacao AS ENUM ('PREVISTO', 'LIQUIDADO', 'CANCELADO');
CREATE TYPE status_cheque AS ENUM ('RECEBIDO', 'DEPOSITADO', 'COMPENSADO', 'DEVOLVIDO', 'CANCELADO');

CREATE TABLE liquidacao_cartao (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id             uuid NOT NULL REFERENCES grupo(id),
  empresa_id           uuid NOT NULL,
  baixa_id             uuid NOT NULL,
  forma_pagamento_id   uuid NOT NULL,
  data_venda           date NOT NULL,
  data_prevista        date NOT NULL CHECK (data_prevista >= data_venda),
  bruto_centavos       bigint NOT NULL CHECK (bruto_centavos > 0),
  taxa_bp              integer NOT NULL DEFAULT 0,
  taxa_centavos        bigint NOT NULL DEFAULT 0 CHECK (taxa_centavos >= 0),
  antecipacao_bp       integer NOT NULL DEFAULT 0,
  antecipacao_centavos bigint NOT NULL DEFAULT 0 CHECK (antecipacao_centavos >= 0),
  liquido_centavos     bigint GENERATED ALWAYS AS (bruto_centavos - taxa_centavos - antecipacao_centavos) STORED,
  status               status_liquidacao NOT NULL DEFAULT 'PREVISTO',
  conta_id             uuid,
  data_liquidacao      date,
  lancamento_id        uuid,
  liquidado_por        uuid,
  liquidado_em         timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  UNIQUE (baixa_id),
  FOREIGN KEY (empresa_id, grupo_id)         REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (baixa_id, grupo_id)           REFERENCES baixa_receber (id, grupo_id),
  FOREIGN KEY (forma_pagamento_id, grupo_id) REFERENCES forma_pagamento (id, grupo_id),
  FOREIGN KEY (conta_id, empresa_id)         REFERENCES conta_financeira (id, empresa_id),
  FOREIGN KEY (lancamento_id, grupo_id)      REFERENCES lancamento_financeiro (id, grupo_id),
  CHECK (bruto_centavos - taxa_centavos - antecipacao_centavos >= 0),
  CHECK ((status = 'LIQUIDADO') = (lancamento_id IS NOT NULL))
);
CREATE INDEX liquidacao_cartao_prevista_idx ON liquidacao_cartao (empresa_id, data_prevista) WHERE status = 'PREVISTO';
CREATE INDEX liquidacao_cartao_venda_idx ON liquidacao_cartao (empresa_id, data_venda);

CREATE TABLE cheque (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  empresa_id       uuid NOT NULL,
  baixa_id         uuid NOT NULL,
  numero           text NOT NULL CHECK (length(numero) BETWEEN 1 AND 20),
  banco            text,
  emitente         text NOT NULL CHECK (length(emitente) BETWEEN 2 AND 120),
  -- data combinada para depositar (cheque pré-datado)
  bom_para         date NOT NULL,
  valor_centavos   bigint NOT NULL CHECK (valor_centavos > 0),
  status           status_cheque NOT NULL DEFAULT 'RECEBIDO',
  conta_deposito_id uuid,
  depositado_em    date,
  compensado_em    date,
  devolvido_em     date,
  motivo_devolucao text,
  lancamento_id    uuid,
  atualizado_por   uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  UNIQUE (baixa_id),
  FOREIGN KEY (empresa_id, grupo_id)         REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (baixa_id, grupo_id)           REFERENCES baixa_receber (id, grupo_id),
  FOREIGN KEY (conta_deposito_id, empresa_id) REFERENCES conta_financeira (id, empresa_id),
  FOREIGN KEY (lancamento_id, grupo_id)      REFERENCES lancamento_financeiro (id, grupo_id)
);
CREATE INDEX cheque_empresa_idx ON cheque (empresa_id, status, bom_para);
CREATE TRIGGER cheque_touch BEFORE UPDATE ON cheque FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['liquidacao_cartao', 'cheque'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON liquidacao_cartao, cheque TO ecv_app;
