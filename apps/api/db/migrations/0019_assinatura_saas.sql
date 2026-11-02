-- Cobrança de assinatura do SaaS: a ECV Cash cobra cada grupo (cliente) por mensalidade.
--   plano_saas        catálogo da plataforma (preço-base, empresas incluídas, valor por empresa adicional)
--   assinatura_saas   contrato do grupo; guarda o preço combinado (reajuste do plano não reescreve contratos)
--   cobranca_saas     uma mensalidade por competência; imutável depois de paga ou cancelada
-- Dinheiro em centavos; desconto em pontos-base. Nada é excluído.

CREATE TYPE status_assinatura AS ENUM ('ATIVA', 'INADIMPLENTE', 'CANCELADA');
CREATE TYPE status_cobranca_saas AS ENUM ('ABERTA', 'PAGA', 'CANCELADA');

CREATE TABLE plano_saas (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                            text NOT NULL UNIQUE,
  descricao                       text,
  valor_base_centavos             bigint NOT NULL CHECK (valor_base_centavos >= 0),
  empresas_incluidas              int NOT NULL DEFAULT 1 CHECK (empresas_incluidas >= 1),
  valor_empresa_adicional_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_empresa_adicional_centavos >= 0),
  ativo                           boolean NOT NULL DEFAULT true,
  criado_em                       timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON plano_saas TO ecv_app;

CREATE TABLE assinatura_saas (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id                         uuid NOT NULL UNIQUE REFERENCES grupo(id),
  plano_id                         uuid NOT NULL REFERENCES plano_saas(id),
  valor_base_centavos              bigint NOT NULL CHECK (valor_base_centavos >= 0),
  empresas_incluidas               int NOT NULL CHECK (empresas_incluidas >= 1),
  valor_empresa_adicional_centavos bigint NOT NULL CHECK (valor_empresa_adicional_centavos >= 0),
  desconto_bp                      int NOT NULL DEFAULT 0 CHECK (desconto_bp BETWEEN 0 AND 10000),
  dia_vencimento                   int NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 28),
  inicio                           date NOT NULL,
  teste_ate                        date,
  status                           status_assinatura NOT NULL DEFAULT 'ATIVA',
  carencia_dias                    int NOT NULL DEFAULT 15 CHECK (carencia_dias BETWEEN 0 AND 90),
  suspende_em_atraso               boolean NOT NULL DEFAULT false,
  suspenso_por_atraso              boolean NOT NULL DEFAULT false,
  cancelada_em                     timestamptz,
  motivo_cancelamento              text,
  criado_em                        timestamptz NOT NULL DEFAULT now(),
  atualizado_em                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  CHECK (status <> 'CANCELADA' OR (cancelada_em IS NOT NULL AND motivo_cancelamento IS NOT NULL))
);

CREATE TABLE cobranca_saas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id                uuid NOT NULL REFERENCES grupo(id),
  assinatura_id           uuid NOT NULL,
  competencia             date NOT NULL CHECK (extract(day FROM competencia) = 1),
  vencimento              date NOT NULL,
  empresas_cobradas       int NOT NULL CHECK (empresas_cobradas >= 0),
  valor_bruto_centavos    bigint NOT NULL CHECK (valor_bruto_centavos >= 0),
  desconto_centavos       bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  valor_centavos          bigint NOT NULL CHECK (valor_centavos >= 0),
  status                  status_cobranca_saas NOT NULL DEFAULT 'ABERTA',
  pago_em                 date,
  forma_pagamento         text,
  referencia              text,
  baixado_por_interno_id  uuid REFERENCES usuario_interno(id),
  motivo_cancelamento     text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (assinatura_id, grupo_id) REFERENCES assinatura_saas (id, grupo_id),
  CHECK (valor_centavos = valor_bruto_centavos - desconto_centavos),
  CHECK (status <> 'PAGA' OR (pago_em IS NOT NULL AND forma_pagamento IS NOT NULL)),
  CHECK (status <> 'CANCELADA' OR motivo_cancelamento IS NOT NULL)
);
-- uma mensalidade viva por competência; cancelada abre espaço para gerar de novo
CREATE UNIQUE INDEX cobranca_saas_competencia_uq ON cobranca_saas (assinatura_id, competencia) WHERE status <> 'CANCELADA';
CREATE INDEX cobranca_saas_grupo_idx ON cobranca_saas (grupo_id, vencimento DESC);

-- Valor, competência e vencimento nunca mudam; paga ou cancelada fica congelada.
CREATE FUNCTION cobranca_saas_protegida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'ABERTA' THEN
    RAISE EXCEPTION 'Mensalidade % não pode mais ser alterada.', lower(OLD.status::text) USING ERRCODE = 'P0001';
  END IF;
  IF NEW.valor_centavos <> OLD.valor_centavos OR NEW.valor_bruto_centavos <> OLD.valor_bruto_centavos OR NEW.desconto_centavos <> OLD.desconto_centavos
     OR NEW.competencia <> OLD.competencia OR NEW.vencimento <> OLD.vencimento OR NEW.assinatura_id <> OLD.assinatura_id OR NEW.grupo_id <> OLD.grupo_id THEN
    RAISE EXCEPTION 'Valor, competência e vencimento da mensalidade não mudam. Cancele com motivo (a competência fica dispensada).' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cobranca_saas_protegida BEFORE UPDATE ON cobranca_saas FOR EACH ROW EXECUTE FUNCTION cobranca_saas_protegida();

ALTER TABLE assinatura_saas ENABLE ROW LEVEL SECURITY; ALTER TABLE assinatura_saas FORCE ROW LEVEL SECURITY;
ALTER TABLE cobranca_saas   ENABLE ROW LEVEL SECURITY; ALTER TABLE cobranca_saas   FORCE ROW LEVEL SECURITY;
CREATE POLICY assinatura_saas_grupo ON assinatura_saas USING (grupo_id = app_grupo_id()) WITH CHECK (grupo_id = app_grupo_id());
CREATE POLICY cobranca_saas_grupo   ON cobranca_saas   USING (grupo_id = app_grupo_id()) WITH CHECK (grupo_id = app_grupo_id());
GRANT SELECT, INSERT, UPDATE ON assinatura_saas, cobranca_saas TO ecv_app;

-- A lista de mensalidades de todos os clientes atravessa grupos: função do dono ecv_definer (como bo_listar_grupos).
GRANT SELECT ON cobranca_saas, assinatura_saas TO ecv_definer;
CREATE FUNCTION bo_listar_cobrancas_saas()
RETURNS TABLE (id uuid, grupo_id uuid, grupo_nome text, competencia date, vencimento date, valor_centavos bigint, status status_cobranca_saas,
               pago_em date, forma_pagamento text, referencia text, assinatura_status status_assinatura)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.grupo_id, g.nome, c.competencia, c.vencimento, c.valor_centavos, c.status, c.pago_em, c.forma_pagamento, c.referencia, a.status
    FROM cobranca_saas c JOIN grupo g ON g.id = c.grupo_id JOIN assinatura_saas a ON a.id = c.assinatura_id
   ORDER BY c.vencimento DESC, g.nome $$;
CREATE FUNCTION bo_listar_assinaturas_saas()
RETURNS TABLE (grupo_id uuid, grupo_nome text, grupo_status status_grupo, plano_nome text, status status_assinatura, valor_base_centavos bigint, teste_ate date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.grupo_id, g.nome, g.status, p.nome, a.status, a.valor_base_centavos, a.teste_ate
    FROM assinatura_saas a JOIN grupo g ON g.id = a.grupo_id JOIN plano_saas p ON p.id = a.plano_id ORDER BY g.nome $$;
GRANT SELECT ON plano_saas TO ecv_definer;
GRANT CREATE ON SCHEMA public TO ecv_definer;
ALTER FUNCTION bo_listar_cobrancas_saas()   OWNER TO ecv_definer;
ALTER FUNCTION bo_listar_assinaturas_saas() OWNER TO ecv_definer;
REVOKE CREATE ON SCHEMA public FROM ecv_definer;
REVOKE ALL ON FUNCTION bo_listar_cobrancas_saas(), bo_listar_assinaturas_saas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bo_listar_cobrancas_saas(), bo_listar_assinaturas_saas() TO ecv_app;
