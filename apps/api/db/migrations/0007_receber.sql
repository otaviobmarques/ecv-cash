-- Contas a receber: um título por laudo (1:1), baixas imutáveis (estorno = baixa contrária) e configuração financeira por loja.
-- O título nasce no lançamento do laudo e acompanha o valor cobrado até receber a primeira baixa ou entrar em fatura.

CREATE TYPE status_titulo AS ENUM ('ABERTO', 'PARCIAL', 'QUITADO', 'CANCELADO');

CREATE TABLE empresa_config (
  empresa_id                  uuid PRIMARY KEY,
  grupo_id                    uuid NOT NULL REFERENCES grupo(id),
  -- até quanto de multa e juros o Financeiro pode perdoar numa baixa (acima disso, só Gerente e Administrativo)
  perdao_limite_centavos      integer NOT NULL DEFAULT 5000 CHECK (perdao_limite_centavos >= 0),
  -- contas a pagar passam por aprovação? o Financeiro pode aprovar?
  aprovacao_pagar_obrigatoria boolean NOT NULL DEFAULT true,
  financeiro_aprova_pagar     boolean NOT NULL DEFAULT false,
  -- o Financeiro vê DRE e balanço?
  financeiro_ve_dre           boolean NOT NULL DEFAULT false,
  atualizado_em               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id)
);

CREATE TABLE titulo_receber (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id           uuid NOT NULL REFERENCES grupo(id),
  empresa_id         uuid NOT NULL,
  laudo_id           uuid NOT NULL,
  cliente_id         uuid NOT NULL,
  forma_pagamento_id uuid NOT NULL,
  valor_centavos     integer NOT NULL CHECK (valor_centavos > 0),
  -- quanto do principal já foi recebido (soma das baixas, sem juros e multa)
  pago_centavos      integer NOT NULL DEFAULT 0 CHECK (pago_centavos >= 0),
  vencimento         date NOT NULL,
  status             status_titulo NOT NULL DEFAULT 'ABERTO',
  fatura_id          uuid,
  numero_nf          text,
  motivo_cancelamento text,
  cancelado_em       timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  UNIQUE (laudo_id),
  FOREIGN KEY (empresa_id, grupo_id)         REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (laudo_id, grupo_id)           REFERENCES laudo (id, grupo_id),
  FOREIGN KEY (cliente_id, grupo_id)         REFERENCES cliente (id, grupo_id),
  FOREIGN KEY (forma_pagamento_id, grupo_id) REFERENCES forma_pagamento (id, grupo_id),
  CHECK (pago_centavos <= valor_centavos),
  CHECK ((status = 'CANCELADO') = (cancelado_em IS NOT NULL))
);
CREATE INDEX titulo_receber_aberto_idx ON titulo_receber (empresa_id, vencimento) WHERE status IN ('ABERTO', 'PARCIAL');
CREATE INDEX titulo_receber_cliente_idx ON titulo_receber (cliente_id, empresa_id);
CREATE INDEX titulo_receber_fatura_idx ON titulo_receber (fatura_id) WHERE fatura_id IS NOT NULL;
CREATE TRIGGER titulo_receber_touch BEFORE UPDATE ON titulo_receber FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Cada recebimento é um registro; nunca se altera. Estorno = novo registro com sinais contrários.
CREATE TABLE baixa_receber (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id           uuid NOT NULL REFERENCES grupo(id),
  empresa_id         uuid NOT NULL,
  titulo_id          uuid NOT NULL,
  data               date NOT NULL,
  principal_centavos bigint NOT NULL CHECK (principal_centavos <> 0),
  multa_centavos     bigint NOT NULL DEFAULT 0,
  juros_centavos     bigint NOT NULL DEFAULT 0,
  perdao_centavos    bigint NOT NULL DEFAULT 0,
  recebido_centavos  bigint GENERATED ALWAYS AS (principal_centavos + multa_centavos + juros_centavos - perdao_centavos) STORED,
  forma_pagamento_id uuid NOT NULL,
  conta_id           uuid,
  lancamento_id      uuid,
  lote_id            uuid,
  estorno_de         uuid,
  motivo             text,
  criado_por         uuid,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)         REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (titulo_id, grupo_id)          REFERENCES titulo_receber (id, grupo_id),
  FOREIGN KEY (forma_pagamento_id, grupo_id) REFERENCES forma_pagamento (id, grupo_id),
  FOREIGN KEY (conta_id, empresa_id)         REFERENCES conta_financeira (id, empresa_id),
  FOREIGN KEY (lancamento_id, grupo_id)      REFERENCES lancamento_financeiro (id, grupo_id),
  FOREIGN KEY (estorno_de, grupo_id)         REFERENCES baixa_receber (id, grupo_id),
  CHECK (estorno_de IS NULL OR motivo IS NOT NULL),
  CHECK (perdao_centavos = 0 OR motivo IS NOT NULL)
);
CREATE UNIQUE INDEX baixa_receber_estorno_uq ON baixa_receber (estorno_de) WHERE estorno_de IS NOT NULL;
CREATE INDEX baixa_receber_titulo_idx ON baixa_receber (titulo_id);
CREATE INDEX baixa_receber_data_idx ON baixa_receber (empresa_id, data);
CREATE INDEX baixa_receber_lote_idx ON baixa_receber (lote_id) WHERE lote_id IS NOT NULL;

CREATE FUNCTION baixa_receber_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Baixa registrada não se altera nem se apaga: faça o estorno.'; END $$;
CREATE TRIGGER baixa_receber_imutavel BEFORE UPDATE OR DELETE ON baixa_receber FOR EACH ROW EXECUTE FUNCTION baixa_receber_imutavel();

-- Nova baixa em período fechado é recusada (a data conta, não o dia em que foi digitada).
CREATE FUNCTION baixa_receber_periodo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF periodo_fechado(NEW.empresa_id, NEW.data) THEN RAISE EXCEPTION 'O período deste mês está fechado. Peça a reabertura ao Administrativo.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER baixa_receber_periodo BEFORE INSERT ON baixa_receber FOR EACH ROW EXECUTE FUNCTION baixa_receber_periodo();

-- Títulos dos laudos que já existem
INSERT INTO titulo_receber (grupo_id, empresa_id, laudo_id, cliente_id, forma_pagamento_id, valor_centavos, vencimento)
SELECT l.grupo_id, l.empresa_id, l.id, l.cliente_id, l.forma_pagamento_id, l.valor_cobrado_centavos,
       CASE WHEN f.gera_fatura THEN l.data_laudo + c.prazo_dias ELSE l.data_laudo END
  FROM laudo l JOIN forma_pagamento f ON f.id = l.forma_pagamento_id JOIN cliente c ON c.id = l.cliente_id
 WHERE l.status = 'ATIVO' AND l.valor_cobrado_centavos > 0;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['empresa_config', 'titulo_receber', 'baixa_receber'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON empresa_config, titulo_receber TO ecv_app;
GRANT SELECT, INSERT ON baixa_receber TO ecv_app;
