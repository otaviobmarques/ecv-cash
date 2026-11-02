-- Balanço gerencial: o que o sistema não calcula sozinho (imobilizado, empréstimos, capital social...) é informado à mão, por conta do plano e data-base.
-- Caixa, contas a receber e contas a pagar vêm do próprio sistema. Não é contabilidade de partida dobrada.
CREATE TABLE saldo_patrimonial_manual (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  empresa_id     uuid NOT NULL,
  plano_conta_id uuid NOT NULL,
  data_base      date NOT NULL,
  valor_centavos bigint NOT NULL CHECK (valor_centavos >= 0),
  observacao     text,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, plano_conta_id, data_base),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (plano_conta_id, grupo_id) REFERENCES plano_conta (id, grupo_id)
);
ALTER TABLE saldo_patrimonial_manual ENABLE ROW LEVEL SECURITY; ALTER TABLE saldo_patrimonial_manual FORCE ROW LEVEL SECURITY;
CREATE POLICY saldo_patrimonial_manual_loja ON saldo_patrimonial_manual
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
GRANT SELECT, INSERT, UPDATE ON saldo_patrimonial_manual TO ecv_app;
