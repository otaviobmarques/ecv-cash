-- Contas a pagar: títulos (manuais, recorrentes, rateados, custos de laudo, royalties e comissões), pagamentos imutáveis (estorno = registro
-- contrário), recorrências e anexos (comprovantes, notas, boletos). Quem cria não aprova; aprovação é configurável por loja.

CREATE TYPE status_pagar AS ENUM ('RASCUNHO', 'PENDENTE', 'APROVADO', 'PARCIAL', 'PAGO', 'CANCELADO');
CREATE TYPE origem_pagar AS ENUM ('MANUAL', 'RECORRENCIA', 'ROYALTY', 'COMISSAO', 'CUSTO_LAUDO', 'RATEIO');
CREATE TYPE frequencia_recorrencia AS ENUM ('SEMANAL', 'QUINZENAL', 'MENSAL', 'ANUAL');

-- Arquivos pequenos (até 5 MB) guardados no banco: comprovantes, notas e boletos. Com o armazenamento S3 (Fase 3) migram para fora.
CREATE TABLE anexo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid NOT NULL REFERENCES grupo(id),
  empresa_id    uuid NOT NULL,
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 160),
  mime          text NOT NULL CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  tamanho_bytes integer NOT NULL CHECK (tamanho_bytes BETWEEN 1 AND 5242880),
  sha256        text NOT NULL,
  conteudo      bytea NOT NULL,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  UNIQUE (id, empresa_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id)
);

CREATE TABLE recorrencia_pagar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id           uuid NOT NULL REFERENCES grupo(id),
  empresa_id         uuid NOT NULL,
  fornecedor_id      uuid,
  descricao          text NOT NULL CHECK (length(descricao) BETWEEN 2 AND 160),
  plano_conta_id     uuid,
  valor_centavos     integer NOT NULL CHECK (valor_centavos > 0),
  frequencia         frequencia_recorrencia NOT NULL,
  -- mensal e anual: dia do mês (1 a 31; em mês curto vale o último dia). semanal e quinzenal: dia da semana (0 = domingo) a partir do início
  dia                smallint NOT NULL CHECK (dia BETWEEN 0 AND 31),
  inicio             date NOT NULL,
  fim                date,
  gerada_ate         date,
  ativa              boolean NOT NULL DEFAULT true,
  criado_por         uuid,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (fornecedor_id, grupo_id)  REFERENCES fornecedor (id, grupo_id),
  FOREIGN KEY (plano_conta_id, grupo_id) REFERENCES plano_conta (id, grupo_id),
  CHECK (fim IS NULL OR fim >= inicio)
);

CREATE TABLE titulo_pagar (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          uuid NOT NULL REFERENCES grupo(id),
  empresa_id        uuid NOT NULL,
  fornecedor_id     uuid,
  -- quando o favorecido não é fornecedor cadastrado (ex.: comissão do vistoriador)
  beneficiario      text,
  descricao         text NOT NULL CHECK (length(descricao) BETWEEN 2 AND 200),
  plano_conta_id    uuid,
  competencia       date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  vencimento        date NOT NULL,
  valor_centavos    integer NOT NULL CHECK (valor_centavos > 0),
  pago_centavos     integer NOT NULL DEFAULT 0 CHECK (pago_centavos >= 0),
  status            status_pagar NOT NULL DEFAULT 'PENDENTE',
  origem            origem_pagar NOT NULL DEFAULT 'MANUAL',
  origem_id         uuid,
  recorrencia_id    uuid,
  rateio_id         uuid,
  numero_documento  text,
  observacao        text,
  anexo_id          uuid,
  motivo_rejeicao   text,
  criado_por        uuid,
  aprovado_por      uuid,
  aprovado_em       timestamptz,
  cancelado_por     uuid,
  cancelado_em      timestamptz,
  motivo_cancelamento text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (fornecedor_id, grupo_id)  REFERENCES fornecedor (id, grupo_id),
  FOREIGN KEY (plano_conta_id, grupo_id) REFERENCES plano_conta (id, grupo_id),
  FOREIGN KEY (recorrencia_id, grupo_id) REFERENCES recorrencia_pagar (id, grupo_id),
  FOREIGN KEY (anexo_id, empresa_id)     REFERENCES anexo (id, empresa_id),
  CHECK (pago_centavos <= valor_centavos),
  CHECK (fornecedor_id IS NOT NULL OR beneficiario IS NOT NULL),
  CHECK ((status = 'CANCELADO') = (cancelado_em IS NOT NULL)),
  -- nunca aprovado por quem criou
  CHECK (aprovado_por IS NULL OR criado_por IS NULL OR aprovado_por <> criado_por OR origem <> 'MANUAL')
);
CREATE INDEX titulo_pagar_empresa_idx ON titulo_pagar (empresa_id, status, vencimento);
CREATE INDEX titulo_pagar_fornecedor_idx ON titulo_pagar (fornecedor_id);
CREATE UNIQUE INDEX titulo_pagar_recorrencia_uq ON titulo_pagar (recorrencia_id, vencimento) WHERE recorrencia_id IS NOT NULL AND status <> 'CANCELADO';
CREATE TRIGGER titulo_pagar_touch BEFORE UPDATE ON titulo_pagar FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

CREATE TABLE pagamento_pagar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id           uuid NOT NULL REFERENCES grupo(id),
  empresa_id         uuid NOT NULL,
  titulo_id          uuid NOT NULL,
  data               date NOT NULL,
  principal_centavos bigint NOT NULL CHECK (principal_centavos <> 0),
  juros_centavos     bigint NOT NULL DEFAULT 0,
  multa_centavos     bigint NOT NULL DEFAULT 0,
  desconto_centavos  bigint NOT NULL DEFAULT 0,
  pago_total_centavos bigint GENERATED ALWAYS AS (principal_centavos + juros_centavos + multa_centavos - desconto_centavos) STORED,
  conta_id           uuid NOT NULL,
  lancamento_id      uuid NOT NULL,
  comprovante_id     uuid,
  estorno_de         uuid,
  motivo             text,
  criado_por         uuid,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)    REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (titulo_id, grupo_id)     REFERENCES titulo_pagar (id, grupo_id),
  FOREIGN KEY (conta_id, empresa_id)    REFERENCES conta_financeira (id, empresa_id),
  FOREIGN KEY (lancamento_id, grupo_id) REFERENCES lancamento_financeiro (id, grupo_id),
  FOREIGN KEY (comprovante_id, empresa_id) REFERENCES anexo (id, empresa_id),
  FOREIGN KEY (estorno_de, grupo_id)    REFERENCES pagamento_pagar (id, grupo_id),
  CHECK (estorno_de IS NULL OR motivo IS NOT NULL)
);
CREATE UNIQUE INDEX pagamento_pagar_estorno_uq ON pagamento_pagar (estorno_de) WHERE estorno_de IS NOT NULL;
CREATE INDEX pagamento_pagar_titulo_idx ON pagamento_pagar (titulo_id);
CREATE INDEX pagamento_pagar_data_idx ON pagamento_pagar (empresa_id, data);

CREATE FUNCTION pagamento_pagar_regras() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Pagamento registrado não se altera nem se apaga: faça o estorno.'; END IF;
  IF periodo_fechado(NEW.empresa_id, NEW.data) THEN RAISE EXCEPTION 'O período deste mês está fechado. Peça a reabertura ao Administrativo.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pagamento_pagar_regras BEFORE INSERT OR UPDATE OR DELETE ON pagamento_pagar FOR EACH ROW EXECUTE FUNCTION pagamento_pagar_regras();

-- Custos de laudo que geram conta a pagar: cada custo entra numa apuração uma única vez.
ALTER TABLE laudo_custo ADD COLUMN titulo_pagar_id uuid;
ALTER TABLE laudo_custo ADD CONSTRAINT laudo_custo_titulo_fk FOREIGN KEY (titulo_pagar_id, grupo_id) REFERENCES titulo_pagar (id, grupo_id);
CREATE INDEX laudo_custo_apurar_idx ON laudo_custo (empresa_id, fornecedor_id) WHERE gera_conta_pagar AND ativo AND titulo_pagar_id IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['anexo', 'recorrencia_pagar', 'titulo_pagar', 'pagamento_pagar'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON anexo, pagamento_pagar TO ecv_app;
GRANT SELECT, INSERT, UPDATE ON recorrencia_pagar, titulo_pagar TO ecv_app;
GRANT UPDATE (titulo_pagar_id) ON laudo_custo TO ecv_app;
