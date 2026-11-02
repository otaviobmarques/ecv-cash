-- Caixa: razão financeiro (todo dinheiro que entra ou sai de uma conta da loja), transferências (inclusive entre lojas do grupo),
-- fechamento diário por conta e fechamento mensal por loja. Nada é excluído nem alterado: erro se corrige com lançamento contrário.

CREATE TYPE origem_lancamento AS ENUM ('BAIXA_RECEBER', 'PAGAMENTO_PAGAR', 'TRANSFERENCIA', 'AJUSTE', 'LIQUIDACAO_CARTAO', 'CHEQUE');
CREATE TYPE status_fechamento AS ENUM ('FECHADO', 'REABERTO');

-- permite FK (conta, loja): o lançamento não pode apontar para conta de outra loja
ALTER TABLE conta_financeira ADD CONSTRAINT conta_financeira_id_empresa_uq UNIQUE (id, empresa_id);

CREATE TABLE lancamento_financeiro (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id        uuid NOT NULL REFERENCES grupo(id),
  empresa_id      uuid NOT NULL,
  conta_id        uuid NOT NULL,
  data            date NOT NULL,
  -- positivo entra, negativo sai
  valor_centavos  bigint NOT NULL CHECK (valor_centavos <> 0),
  origem          origem_lancamento NOT NULL,
  origem_id       uuid,
  plano_conta_id  uuid,
  descricao       text NOT NULL CHECK (length(descricao) BETWEEN 2 AND 200),
  estorno_de      uuid,
  motivo          text,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)        REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (conta_id, empresa_id)        REFERENCES conta_financeira (id, empresa_id),
  FOREIGN KEY (plano_conta_id, grupo_id)    REFERENCES plano_conta (id, grupo_id),
  FOREIGN KEY (estorno_de, grupo_id)        REFERENCES lancamento_financeiro (id, grupo_id),
  CHECK (estorno_de IS NULL OR motivo IS NOT NULL)
);
CREATE UNIQUE INDEX lancamento_estorno_uq ON lancamento_financeiro (estorno_de) WHERE estorno_de IS NOT NULL;
CREATE INDEX lancamento_conta_data_idx ON lancamento_financeiro (conta_id, data, criado_em);
CREATE INDEX lancamento_empresa_data_idx ON lancamento_financeiro (empresa_id, data);
CREATE INDEX lancamento_origem_idx ON lancamento_financeiro (origem, origem_id);

CREATE TABLE transferencia (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  empresa_origem_id  uuid NOT NULL,
  conta_origem_id    uuid NOT NULL,
  empresa_destino_id uuid NOT NULL,
  conta_destino_id   uuid NOT NULL,
  data             date NOT NULL,
  valor_centavos   bigint NOT NULL CHECK (valor_centavos > 0),
  -- entre lojas do mesmo grupo: some na visão consolidada da rede
  intercompany     boolean GENERATED ALWAYS AS (empresa_origem_id <> empresa_destino_id) STORED,
  descricao        text NOT NULL CHECK (length(descricao) BETWEEN 2 AND 200),
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (conta_origem_id, empresa_origem_id)   REFERENCES conta_financeira (id, empresa_id),
  FOREIGN KEY (conta_destino_id, empresa_destino_id) REFERENCES conta_financeira (id, empresa_id),
  CHECK (conta_origem_id <> conta_destino_id)
);

-- Fechamento diário: depois de fechado o dia D de uma conta, nada com data até D entra nela.
CREATE TABLE fechamento_caixa (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id             uuid NOT NULL REFERENCES grupo(id),
  empresa_id           uuid NOT NULL,
  conta_id             uuid NOT NULL,
  data                 date NOT NULL,
  saldo_sistema_centavos bigint NOT NULL,
  saldo_contado_centavos bigint NOT NULL,
  diferenca_centavos   bigint GENERATED ALWAYS AS (saldo_contado_centavos - saldo_sistema_centavos) STORED,
  observacao           text,
  status               status_fechamento NOT NULL DEFAULT 'FECHADO',
  fechado_por          uuid,
  fechado_em           timestamptz NOT NULL DEFAULT now(),
  reaberto_por         uuid,
  reaberto_em          timestamptz,
  motivo_reabertura    text,
  UNIQUE (conta_id, data),
  FOREIGN KEY (conta_id, empresa_id) REFERENCES conta_financeira (id, empresa_id),
  CHECK (status = 'FECHADO' OR motivo_reabertura IS NOT NULL)
);
CREATE INDEX fechamento_caixa_conta_idx ON fechamento_caixa (conta_id, data DESC);

-- Fechamento mensal da loja: depois de fechado, nada daquele mês muda (lançamentos, laudos).
CREATE TABLE fechamento_periodo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid NOT NULL REFERENCES grupo(id),
  empresa_id    uuid NOT NULL,
  mes           date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  status        status_fechamento NOT NULL DEFAULT 'FECHADO',
  fechado_por   uuid,
  fechado_em    timestamptz NOT NULL DEFAULT now(),
  reaberto_por  uuid,
  reaberto_em   timestamptz,
  motivo_reabertura text,
  UNIQUE (empresa_id, mes),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  CHECK (status = 'FECHADO' OR motivo_reabertura IS NOT NULL)
);

CREATE FUNCTION periodo_fechado(p_empresa uuid, p_data date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM fechamento_periodo WHERE empresa_id = p_empresa AND mes = date_trunc('month', p_data)::date AND status = 'FECHADO')
$$;

CREATE FUNCTION lancamento_regras() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Lançamento financeiro não se altera nem se apaga: faça o estorno.'; END IF;
  IF EXISTS (SELECT 1 FROM fechamento_caixa WHERE conta_id = NEW.conta_id AND status = 'FECHADO' AND data >= NEW.data) THEN
    RAISE EXCEPTION 'O caixa desta conta já está fechado nesta data. Reabra o dia ou lance numa data posterior.';
  END IF;
  IF periodo_fechado(NEW.empresa_id, NEW.data) THEN
    RAISE EXCEPTION 'O período deste mês está fechado. Peça a reabertura ao Administrativo.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lancamento_regras BEFORE INSERT OR UPDATE OR DELETE ON lancamento_financeiro FOR EACH ROW EXECUTE FUNCTION lancamento_regras();

-- Laudo cuja data caiu em mês fechado não nasce nem muda valor, cliente, serviço, data ou forma.
CREATE OR REPLACE FUNCTION laudo_protegido() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF periodo_fechado(NEW.empresa_id, NEW.data_laudo) THEN RAISE EXCEPTION 'O período deste mês está fechado: não é possível lançar laudo nesta data.'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Laudo cancelado não pode ser alterado.';
  END IF;
  IF OLD.travado_em IS NOT NULL AND (
       NEW.valor_cobrado_centavos IS DISTINCT FROM OLD.valor_cobrado_centavos OR NEW.preco_tabela_centavos IS DISTINCT FROM OLD.preco_tabela_centavos
    OR NEW.cliente_id <> OLD.cliente_id OR NEW.servico_id <> OLD.servico_id OR NEW.data_laudo <> OLD.data_laudo
    OR NEW.placa <> OLD.placa OR NEW.forma_pagamento_id <> OLD.forma_pagamento_id OR NEW.empresa_id <> OLD.empresa_id) THEN
    RAISE EXCEPTION 'Laudo já faturado ou baixado não muda. Cancele a fatura ou estorne a baixa primeiro.';
  END IF;
  IF (periodo_fechado(OLD.empresa_id, OLD.data_laudo) OR periodo_fechado(NEW.empresa_id, NEW.data_laudo)) AND (
       NEW.valor_cobrado_centavos IS DISTINCT FROM OLD.valor_cobrado_centavos OR NEW.cliente_id <> OLD.cliente_id OR NEW.servico_id <> OLD.servico_id
    OR NEW.data_laudo <> OLD.data_laudo OR NEW.forma_pagamento_id <> OLD.forma_pagamento_id OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'O período deste laudo está fechado. Peça a reabertura ao Administrativo.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER laudo_protegido ON laudo;
CREATE TRIGGER laudo_protegido BEFORE INSERT OR UPDATE ON laudo FOR EACH ROW EXECUTE FUNCTION laudo_protegido();

ALTER TABLE lancamento_financeiro ENABLE ROW LEVEL SECURITY; ALTER TABLE lancamento_financeiro FORCE ROW LEVEL SECURITY;
ALTER TABLE fechamento_caixa      ENABLE ROW LEVEL SECURITY; ALTER TABLE fechamento_caixa      FORCE ROW LEVEL SECURITY;
ALTER TABLE fechamento_periodo    ENABLE ROW LEVEL SECURITY; ALTER TABLE fechamento_periodo    FORCE ROW LEVEL SECURITY;
ALTER TABLE transferencia         ENABLE ROW LEVEL SECURITY; ALTER TABLE transferencia         FORCE ROW LEVEL SECURITY;
CREATE POLICY lancamento_loja ON lancamento_financeiro
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
CREATE POLICY fechamento_caixa_loja ON fechamento_caixa
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
CREATE POLICY fechamento_periodo_loja ON fechamento_periodo
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
-- a transferência aparece para as duas pontas; quem cria precisa enxergar a loja de origem
CREATE POLICY transferencia_loja ON transferencia
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_origem_id = ANY (app_empresas()) OR empresa_destino_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR (empresa_origem_id = ANY (app_empresas()) AND empresa_destino_id = ANY (app_empresas()))));

GRANT SELECT, INSERT ON lancamento_financeiro, transferencia TO ecv_app;
GRANT SELECT, INSERT, UPDATE ON fechamento_caixa, fechamento_periodo TO ecv_app;
