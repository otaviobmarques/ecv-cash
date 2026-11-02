-- Aprovação de contas a pagar em níveis, por faixa de valor (por loja):
--   até o limite do Gerente: quem pode aprovar já podia (Gerente, Administrativo, e o Financeiro se a loja liberou);
--   acima do limite do Gerente: só o Administrativo;
--   acima do limite da dupla aprovação: duas pessoas diferentes, uma delas Administrativo.
ALTER TABLE empresa_config
  ADD COLUMN aprovacao_limite_gerente_centavos bigint CHECK (aprovacao_limite_gerente_centavos IS NULL OR aprovacao_limite_gerente_centavos > 0),
  ADD COLUMN aprovacao_dupla_acima_centavos    bigint CHECK (aprovacao_dupla_acima_centavos IS NULL OR aprovacao_dupla_acima_centavos > 0);

CREATE TABLE aprovacao_pagar (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id   uuid NOT NULL REFERENCES grupo(id),
  empresa_id uuid NOT NULL,
  titulo_id  uuid NOT NULL,
  usuario_id uuid NOT NULL,
  perfil     text NOT NULL,
  -- aprovações dadas antes de o valor ou o favorecido mudar deixam de valer
  valida     boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (titulo_id, grupo_id)  REFERENCES titulo_pagar (id, grupo_id)
);
CREATE UNIQUE INDEX aprovacao_pagar_uq ON aprovacao_pagar (titulo_id, usuario_id) WHERE valida;
CREATE INDEX aprovacao_pagar_titulo_idx ON aprovacao_pagar (titulo_id);
ALTER TABLE aprovacao_pagar ENABLE ROW LEVEL SECURITY; ALTER TABLE aprovacao_pagar FORCE ROW LEVEL SECURITY;
CREATE POLICY aprovacao_pagar_loja ON aprovacao_pagar
  USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
  WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())));
GRANT SELECT, INSERT, UPDATE ON aprovacao_pagar TO ecv_app;
