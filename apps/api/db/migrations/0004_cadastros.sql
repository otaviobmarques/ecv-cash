-- Cadastros: plano de contas, serviços e custos, fornecedores, clientes e preços (com vigência), vistoriadores,
-- formas de pagamento (e taxas por empresa) e contas financeiras (caixa e bancos, com dados para a fatura).
-- Cliente, serviço, fornecedor, forma de pagamento e plano de contas são do GRUPO (valem para todas as lojas).
-- Vistoriador, conta financeira e taxa de pagamento são da LOJA e seguem o isolamento por loja.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE tipo_conta_plano   AS ENUM ('RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'ATIVO', 'PASSIVO', 'PATRIMONIO');
CREATE TYPE tipo_valor_custo   AS ENUM ('VALOR', 'PERCENTUAL');
CREATE TYPE tipo_fornecedor    AS ENUM ('FORNECEDOR', 'PRESTADOR', 'CONCESSIONARIA', 'ORGAO_PUBLICO', 'FRANQUEADOR');
CREATE TYPE tipo_pessoa        AS ENUM ('PF', 'PJ');
CREATE TYPE periodicidade_fatura AS ENUM ('SEMANAL', 'QUINZENAL', 'MENSAL');
CREATE TYPE tipo_forma_pagamento AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'CHEQUE', 'FATURADO', 'OUTRA');
CREATE TYPE tipo_conta_financeira AS ENUM ('CAIXA', 'BANCO');
CREATE TYPE tipo_conta_bancaria AS ENUM ('CORRENTE', 'POUPANCA', 'PAGAMENTO');
CREATE TYPE tipo_chave_pix AS ENUM ('CNPJ', 'CPF', 'EMAIL', 'TELEFONE', 'ALEATORIA');
CREATE TYPE status_pedido AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

CREATE TABLE plano_conta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  codigo           text NOT NULL CHECK (codigo ~ '^[0-9]+(\.[0-9]+)*$'),
  nome             text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  tipo             tipo_conta_plano NOT NULL,
  pai_id           uuid,
  aceita_lancamento boolean NOT NULL DEFAULT true,
  status           status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  UNIQUE (grupo_id, codigo),
  FOREIGN KEY (pai_id, grupo_id) REFERENCES plano_conta (id, grupo_id)
);

CREATE TABLE servico (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          uuid NOT NULL REFERENCES grupo(id),
  nome              text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  codigo            text,
  conta_receita_id  uuid,
  status            status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (conta_receita_id, grupo_id) REFERENCES plano_conta (id, grupo_id)
);
CREATE UNIQUE INDEX servico_nome_uq ON servico (grupo_id, lower(nome));

CREATE TABLE fornecedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  nome             text NOT NULL CHECK (length(nome) BETWEEN 2 AND 160),
  documento        text CHECK (documento IS NULL OR documento ~ '^([0-9]{11}|[0-9]{14})$'),
  tipo             tipo_fornecedor NOT NULL DEFAULT 'FORNECEDOR',
  email            text,
  conta_padrao_id  uuid,
  status           status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (conta_padrao_id, grupo_id) REFERENCES plano_conta (id, grupo_id)
);
CREATE UNIQUE INDEX fornecedor_doc_uq ON fornecedor (grupo_id, documento) WHERE documento IS NOT NULL;

-- Custos diretos por laudo de um serviço (taxa do Detran, tarifa do sistema de laudo...). Entram na margem.
CREATE TABLE servico_custo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         uuid NOT NULL REFERENCES grupo(id),
  servico_id       uuid NOT NULL,
  descricao        text NOT NULL CHECK (length(descricao) BETWEEN 2 AND 120),
  tipo             tipo_valor_custo NOT NULL,
  valor_centavos   integer,
  percentual_bp    integer,
  gera_conta_pagar boolean NOT NULL DEFAULT false,
  fornecedor_id    uuid,
  status           status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (servico_id, grupo_id)    REFERENCES servico (id, grupo_id),
  FOREIGN KEY (fornecedor_id, grupo_id) REFERENCES fornecedor (id, grupo_id),
  CHECK ((tipo = 'VALOR' AND valor_centavos >= 0 AND percentual_bp IS NULL)
      OR (tipo = 'PERCENTUAL' AND percentual_bp BETWEEN 0 AND 10000 AND valor_centavos IS NULL))
);
CREATE INDEX servico_custo_servico_idx ON servico_custo (servico_id);

CREATE TABLE cliente (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id        uuid NOT NULL REFERENCES grupo(id),
  tipo_pessoa     tipo_pessoa NOT NULL,
  documento       text CHECK (documento IS NULL OR documento ~ '^([0-9]{11}|[0-9]{14})$'),
  nome            text NOT NULL CHECK (length(nome) BETWEEN 2 AND 160),
  emails_cobranca text[] NOT NULL DEFAULT '{}',
  telefone        text,
  -- como a fatura deste cliente é gerada e cobrada
  periodicidade   periodicidade_fatura NOT NULL DEFAULT 'MENSAL',
  prazo_dias      smallint NOT NULL DEFAULT 10 CHECK (prazo_dias BETWEEN 0 AND 365),
  multa_bp        integer NOT NULL DEFAULT 200 CHECK (multa_bp BETWEEN 0 AND 2000),
  juros_mes_bp    integer NOT NULL DEFAULT 100 CHECK (juros_mes_bp BETWEEN 0 AND 1000),
  status          status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id)
);
CREATE UNIQUE INDEX cliente_doc_uq ON cliente (grupo_id, documento) WHERE documento IS NOT NULL;
CREATE INDEX cliente_nome_idx ON cliente (grupo_id, lower(nome));

-- Preço do cliente por serviço, com vigência. Vale para todas as lojas do grupo.
-- Vigências do mesmo cliente e serviço nunca se sobrepõem; reajuste fecha a anterior e abre a nova.
CREATE TABLE cliente_preco (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  cliente_id     uuid NOT NULL,
  servico_id     uuid NOT NULL,
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  vigencia_ini   date NOT NULL,
  vigencia_fim   date,
  motivo         text,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cliente_id, grupo_id) REFERENCES cliente (id, grupo_id),
  FOREIGN KEY (servico_id, grupo_id) REFERENCES servico (id, grupo_id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_ini),
  EXCLUDE USING gist (cliente_id WITH =, servico_id WITH =, daterange(vigencia_ini, coalesce(vigencia_fim, 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX cliente_preco_busca_idx ON cliente_preco (cliente_id, servico_id, vigencia_ini DESC);

-- O histórico de preços não se reescreve: depois de gravado, só dá para encerrar a vigência.
CREATE FUNCTION cliente_preco_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.valor_centavos <> OLD.valor_centavos OR NEW.vigencia_ini <> OLD.vigencia_ini
     OR NEW.cliente_id <> OLD.cliente_id OR NEW.servico_id <> OLD.servico_id THEN
    RAISE EXCEPTION 'Preço gravado não muda: encerre a vigência e cadastre um novo preço.';
  END IF;
  IF OLD.vigencia_fim IS NOT NULL AND NEW.vigencia_fim IS DISTINCT FROM OLD.vigencia_fim THEN
    RAISE EXCEPTION 'Vigência já encerrada não muda.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cliente_preco_imutavel BEFORE UPDATE ON cliente_preco FOR EACH ROW EXECUTE FUNCTION cliente_preco_imutavel();

CREATE TABLE forma_pagamento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid NOT NULL REFERENCES grupo(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60),
  tipo          tipo_forma_pagamento NOT NULL,
  gera_fatura   boolean NOT NULL DEFAULT false,
  status        status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id)
);
CREATE UNIQUE INDEX forma_pagamento_nome_uq ON forma_pagamento (grupo_id, lower(nome));

-- Taxa da operadora, prazo de recebimento e antecipação, por loja e forma de pagamento.
CREATE TABLE forma_pagamento_empresa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id       uuid NOT NULL REFERENCES grupo(id),
  forma_id       uuid NOT NULL,
  empresa_id     uuid NOT NULL,
  taxa_bp        integer NOT NULL DEFAULT 0 CHECK (taxa_bp BETWEEN 0 AND 3000),
  prazo_dias     smallint NOT NULL DEFAULT 0 CHECK (prazo_dias BETWEEN 0 AND 180),
  antecipacao_bp integer NOT NULL DEFAULT 0 CHECK (antecipacao_bp BETWEEN 0 AND 3000),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forma_id, empresa_id),
  FOREIGN KEY (forma_id, grupo_id)   REFERENCES forma_pagamento (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id)
);

CREATE TABLE vistoriador (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      uuid NOT NULL REFERENCES grupo(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  cpf           text CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
  usuario_id    uuid,
  status        status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (usuario_id, grupo_id) REFERENCES usuario (id, grupo_id)
);
CREATE UNIQUE INDEX vistoriador_cpf_uq ON vistoriador (grupo_id, cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX vistoriador_usuario_uq ON vistoriador (usuario_id) WHERE usuario_id IS NOT NULL;

CREATE TABLE vistoriador_empresa (
  vistoriador_id uuid NOT NULL,
  empresa_id     uuid NOT NULL,
  grupo_id       uuid NOT NULL,
  PRIMARY KEY (vistoriador_id, empresa_id),
  FOREIGN KEY (vistoriador_id, grupo_id) REFERENCES vistoriador (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id)     REFERENCES empresa (id, grupo_id)
);
CREATE INDEX vistoriador_empresa_empresa_idx ON vistoriador_empresa (empresa_id);

-- Caixa e bancos da loja. Os dados bancários e a chave PIX alimentam o bloco "Como pagar" da fatura.
CREATE TABLE conta_financeira (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id             uuid NOT NULL REFERENCES grupo(id),
  empresa_id           uuid NOT NULL,
  nome                 text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  tipo                 tipo_conta_financeira NOT NULL,
  saldo_inicial_centavos bigint NOT NULL DEFAULT 0,
  data_saldo_inicial   date NOT NULL DEFAULT current_date,
  banco                text,
  agencia              text CHECK (agencia IS NULL OR agencia ~ '^[0-9-]{1,10}$'),
  conta                text CHECK (conta IS NULL OR conta ~ '^[0-9Xx-]{1,20}$'),
  tipo_conta           tipo_conta_bancaria,
  titular              text,
  documento_titular    text CHECK (documento_titular IS NULL OR documento_titular ~ '^([0-9]{11}|[0-9]{14})$'),
  pix_tipo             tipo_chave_pix,
  pix_chave            text,
  exibir_na_fatura     boolean NOT NULL DEFAULT false,
  status               status_cadastro NOT NULL DEFAULT 'ATIVO',
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, grupo_id),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  CHECK ((pix_tipo IS NULL) = (pix_chave IS NULL)),
  -- o que aparece na fatura precisa estar completo, para o cliente conseguir pagar
  CHECK (NOT exibir_na_fatura OR (tipo = 'BANCO' AND banco IS NOT NULL AND titular IS NOT NULL AND documento_titular IS NOT NULL
         AND ((agencia IS NOT NULL AND conta IS NOT NULL) OR pix_chave IS NOT NULL)))
);
CREATE INDEX conta_financeira_empresa_idx ON conta_financeira (empresa_id);

-- Mudança em conta que aparece na fatura passa por confirmação do Administrativo (com senha).
-- O pedido do Gerente fica pendente e a conta continua como estava até a aprovação.
CREATE TABLE conta_financeira_pedido (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id        uuid NOT NULL REFERENCES grupo(id),
  empresa_id      uuid NOT NULL,
  conta_id        uuid,
  dados           jsonb NOT NULL,
  solicitado_por  uuid NOT NULL,
  status          status_pedido NOT NULL DEFAULT 'PENDENTE',
  decidido_por    uuid,
  decidido_em     timestamptz,
  motivo_rejeicao text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, grupo_id) REFERENCES empresa (id, grupo_id),
  FOREIGN KEY (conta_id, grupo_id)   REFERENCES conta_financeira (id, grupo_id)
);
CREATE UNIQUE INDEX conta_pedido_pendente_uq ON conta_financeira_pedido (conta_id) WHERE status = 'PENDENTE' AND conta_id IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['plano_conta','servico','fornecedor','servico_custo','cliente','forma_pagamento','vistoriador','conta_financeira'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em()', t || '_touch', t);
  END LOOP;
END $$;

-- Isolamento. Tabelas do grupo: só o grupo. Tabelas da loja: grupo e loja.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['plano_conta','servico','fornecedor','servico_custo','cliente','cliente_preco','forma_pagamento'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (grupo_id = app_grupo_id()) WITH CHECK (grupo_id = app_grupo_id())', t || '_grupo', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['forma_pagamento_empresa','conta_financeira','conta_financeira_pedido','vistoriador_empresa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))
      WITH CHECK (grupo_id = app_grupo_id() AND (app_rede() OR empresa_id = ANY (app_empresas())))$p$, t || '_loja', t);
  END LOOP;
END $$;

ALTER TABLE vistoriador ENABLE ROW LEVEL SECURITY; ALTER TABLE vistoriador FORCE ROW LEVEL SECURITY;
CREATE POLICY vistoriador_sel ON vistoriador FOR SELECT
  USING (grupo_id = app_grupo_id() AND (app_rede() OR EXISTS (
    SELECT 1 FROM vistoriador_empresa ve WHERE ve.vistoriador_id = vistoriador.id AND ve.empresa_id = ANY (app_empresas()))));
CREATE POLICY vistoriador_ins ON vistoriador FOR INSERT WITH CHECK (grupo_id = app_grupo_id());
CREATE POLICY vistoriador_upd ON vistoriador FOR UPDATE
  USING (grupo_id = app_grupo_id() AND (app_rede() OR EXISTS (
    SELECT 1 FROM vistoriador_empresa ve WHERE ve.vistoriador_id = vistoriador.id AND ve.empresa_id = ANY (app_empresas()))))
  WITH CHECK (grupo_id = app_grupo_id());

-- Sem DELETE em tabela de negócio. A exceção é a lotação do vistoriador em loja, como a do usuário.
GRANT SELECT, INSERT, UPDATE ON plano_conta, servico, servico_custo, fornecedor, cliente, cliente_preco, forma_pagamento,
  forma_pagamento_empresa, vistoriador, conta_financeira, conta_financeira_pedido TO ecv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vistoriador_empresa TO ecv_app;
