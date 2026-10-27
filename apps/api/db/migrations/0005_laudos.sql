-- Laudos: o registro de cada vistoria, com preço, custos e margem GRAVADOS no momento do lançamento.
-- Reajuste de preço, mudança de custo ou de regra depois nunca reescrevem um laudo já lançado.

CREATE TYPE status_laudo AS ENUM ('ATIVO', 'CANCELADO');

CREATE TABLE laudo (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id                    uuid NOT NULL REFERENCES grupo(id),
  empresa_id                  uuid NOT NULL,
  numero_interno              bigint GENERATED ALWAYS AS IDENTITY,
  numero_laudo                text CHECK (numero_laudo IS NULL OR length(numero_laudo) BETWEEN 1 AND 40),
  placa                       text NOT NULL CHECK (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  chassi                      text CHECK (chassi IS NULL OR chassi ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  data_laudo                  date NOT NULL,
  cliente_id                  uuid NOT NULL,
  servico_id                  uuid NOT NULL,
  vistoriador_id              uuid NOT NULL,
  forma_pagamento_id          uuid NOT NULL,
  -- preço da tabela do cliente na data do laudo; nulo quando o cliente não tinha preço (aí o valor foi digitado)
  preco_tabela_centavos       integer CHECK (preco_tabela_centavos IS NULL OR preco_tabela_centavos > 0),
  preco_manual                boolean NOT NULL DEFAULT false,
  valor_cobrado_centavos      integer NOT NULL CHECK (valor_cobrado_centavos >= 0),
  ajuste_motivo               text,
  duplicidade_motivo          text,
  observacao                  text CHECK (observacao IS NULL OR length(observacao) <= 500),
  status                      status_laudo NOT NULL DEFAULT 'ATIVO',
  lote_id                     uuid,
  cancelamento_pedido_por     uuid,
  cancelamento_pedido_em      timestamptz,
  cancelamento_pedido_motivo  text,
  cancelado_por               uuid,
  cancelado_em                timestamptz,
  motivo_cancelamento         text,
  revisado_por                uuid,
  revisado_em                 timestamptz,
  -- preenchido quando o laudo entra numa fatura ou recebe baixa: daí em diante o que foi cobrado não muda
  travado_em                  timestamptz,
  criado_por                  uuid NOT NULL,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  atualizado_em               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)         REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (cliente_id, grupo_id)         REFERENCES cliente (id, grupo_id),
  FOREIGN KEY (servico_id, grupo_id)         REFERENCES servico (id, grupo_id),
  FOREIGN KEY (vistoriador_id, grupo_id)     REFERENCES vistoriador (id, grupo_id),
  FOREIGN KEY (forma_pagamento_id, grupo_id) REFERENCES forma_pagamento (id, grupo_id),
  CHECK (preco_manual = (preco_tabela_centavos IS NULL)),
  CHECK (status <> 'CANCELADO' OR (cancelado_por IS NOT NULL AND cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL))
);
-- O número do laudo, quando informado, é único por empresa entre os laudos ativos.
CREATE UNIQUE INDEX laudo_numero_uq ON laudo (empresa_id, numero_laudo) WHERE numero_laudo IS NOT NULL AND status = 'ATIVO';
CREATE INDEX laudo_empresa_data_idx    ON laudo (empresa_id, data_laudo DESC, numero_interno DESC);
CREATE INDEX laudo_duplicidade_idx     ON laudo (empresa_id, placa, servico_id, data_laudo) WHERE status = 'ATIVO';
CREATE INDEX laudo_cliente_idx         ON laudo (cliente_id, data_laudo DESC);
CREATE INDEX laudo_vistoriador_idx     ON laudo (vistoriador_id, data_laudo DESC);
CREATE INDEX laudo_revisar_idx         ON laudo (empresa_id) WHERE preco_manual AND revisado_em IS NULL AND status = 'ATIVO';
CREATE INDEX laudo_pedido_cancel_idx   ON laudo (empresa_id) WHERE cancelamento_pedido_em IS NOT NULL AND status = 'ATIVO';

-- Custos diretos do laudo, calculados no lançamento. Ao recalcular (edição), os antigos ficam inativos: nada se apaga.
CREATE TABLE laudo_custo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  empresa_id       uuid NOT NULL,
  laudo_id         uuid NOT NULL,
  servico_custo_id uuid,
  descricao        text NOT NULL,
  tipo             tipo_valor_custo NOT NULL,
  valor_centavos   integer NOT NULL CHECK (valor_centavos >= 0),
  fornecedor_id    uuid,
  gera_conta_pagar boolean NOT NULL DEFAULT false,
  ativo            boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id)    REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (laudo_id, grupo_id)      REFERENCES laudo (id, grupo_id),
  FOREIGN KEY (fornecedor_id, grupo_id) REFERENCES fornecedor (id, grupo_id)
);
CREATE INDEX laudo_custo_laudo_idx ON laudo_custo (laudo_id) WHERE ativo;

-- Laudo cancelado não muda mais. Laudo travado (faturado ou baixado) não muda o que foi cobrado nem a quem.
CREATE FUNCTION laudo_protegido() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Laudo cancelado não pode ser alterado.';
  END IF;
  IF OLD.travado_em IS NOT NULL AND (
       NEW.valor_cobrado_centavos IS DISTINCT FROM OLD.valor_cobrado_centavos OR NEW.preco_tabela_centavos IS DISTINCT FROM OLD.preco_tabela_centavos
    OR NEW.cliente_id <> OLD.cliente_id OR NEW.servico_id <> OLD.servico_id OR NEW.data_laudo <> OLD.data_laudo
    OR NEW.placa <> OLD.placa OR NEW.forma_pagamento_id <> OLD.forma_pagamento_id OR NEW.empresa_id <> OLD.empresa_id) THEN
    RAISE EXCEPTION 'Laudo já faturado ou baixado não muda. Cancele a fatura ou estorne a baixa primeiro.';
  END IF;
  IF OLD.travado_em IS NOT NULL AND NEW.travado_em IS NULL AND NEW.status = 'ATIVO' AND OLD.status = 'ATIVO' THEN
    NULL; -- destravar acontece quando a fatura é cancelada ou a baixa estornada
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER laudo_protegido BEFORE UPDATE ON laudo FOR EACH ROW EXECUTE FUNCTION laudo_protegido();
CREATE TRIGGER laudo_touch BEFORE UPDATE ON laudo FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE laudo       ENABLE ROW LEVEL SECURITY; ALTER TABLE laudo       FORCE ROW LEVEL SECURITY;
ALTER TABLE laudo_custo ENABLE ROW LEVEL SECURITY; ALTER TABLE laudo_custo FORCE ROW LEVEL SECURITY;
CREATE POLICY laudo_loja ON laudo
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
CREATE POLICY laudo_custo_loja ON laudo_custo
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));

GRANT SELECT, INSERT, UPDATE ON laudo, laudo_custo TO ecv_app;
