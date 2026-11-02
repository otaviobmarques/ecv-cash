-- Faturas: uma por loja × cliente × período. Reúne títulos a receber de formas "faturadas" e ganha o vencimento da fatura.
-- Os dados bancários do bloco "Como pagar" são lidos da conta marcada para aparecer na fatura no momento de gerar o PDF.

CREATE TYPE status_fatura AS ENUM ('ABERTA', 'PARCIAL', 'PAGA', 'CANCELADA');

CREATE TABLE fatura (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  empresa_id       uuid NOT NULL,
  cliente_id       uuid NOT NULL,
  numero           bigint GENERATED ALWAYS AS IDENTITY,
  periodo_ini      date NOT NULL,
  periodo_fim      date NOT NULL,
  emissao          date NOT NULL,
  vencimento       date NOT NULL,
  total_centavos   integer NOT NULL CHECK (total_centavos > 0),
  status           status_fatura NOT NULL DEFAULT 'ABERTA',
  -- regra de atraso do cliente na hora da emissão (a fatura não muda se o cadastro mudar depois)
  multa_bp         integer NOT NULL,
  juros_mes_bp     integer NOT NULL,
  -- só referência: a emissão fiscal e o boleto são feitos fora do sistema
  numero_nf        text,
  numero_boleto    text,
  observacao       text,
  cancelado_em     timestamptz,
  cancelado_por    uuid,
  motivo_cancelamento text,
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (cliente_id, grupo_id) REFERENCES cliente (id, grupo_id),
  CHECK (periodo_fim >= periodo_ini),
  CHECK (vencimento >= emissao),
  CHECK ((status = 'CANCELADA') = (cancelado_em IS NOT NULL))
);
CREATE INDEX fatura_empresa_idx ON fatura (empresa_id, status, vencimento);
CREATE INDEX fatura_cliente_idx ON fatura (cliente_id, empresa_id, periodo_ini);
CREATE TRIGGER fatura_touch BEFORE UPDATE ON fatura FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- O que foi cobrado não se reescreve: total, cliente, período e regras de atraso ficam como emitidos.
CREATE FUNCTION fatura_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_centavos <> OLD.total_centavos OR NEW.cliente_id <> OLD.cliente_id OR NEW.empresa_id <> OLD.empresa_id OR NEW.periodo_ini <> OLD.periodo_ini
     OR NEW.periodo_fim <> OLD.periodo_fim OR NEW.emissao <> OLD.emissao OR NEW.vencimento <> OLD.vencimento OR NEW.multa_bp <> OLD.multa_bp OR NEW.juros_mes_bp <> OLD.juros_mes_bp THEN
    RAISE EXCEPTION 'Fatura emitida não muda valor, cliente, período nem vencimento: cancele e gere outra.';
  END IF;
  IF OLD.status = 'CANCELADA' THEN RAISE EXCEPTION 'Fatura cancelada não pode ser alterada.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fatura_imutavel BEFORE UPDATE ON fatura FOR EACH ROW EXECUTE FUNCTION fatura_imutavel();

ALTER TABLE titulo_receber ADD CONSTRAINT titulo_receber_fatura_fk FOREIGN KEY (fatura_id, grupo_id) REFERENCES fatura (id, grupo_id);

ALTER TABLE fatura ENABLE ROW LEVEL SECURITY; ALTER TABLE fatura FORCE ROW LEVEL SECURITY;
CREATE POLICY fatura_loja ON fatura
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
GRANT SELECT, INSERT, UPDATE ON fatura TO ecv_app;
