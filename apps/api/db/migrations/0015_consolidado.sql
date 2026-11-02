-- Consolidado da rede: cliente ou fornecedor que é, na verdade, outra empresa do mesmo grupo. O que uma loja cobra ou paga à outra
-- aparece no resultado de cada loja, mas some do resultado consolidado (eliminação de intercompany).

ALTER TABLE cliente    ADD COLUMN empresa_vinculada_id uuid;
ALTER TABLE fornecedor ADD COLUMN empresa_vinculada_id uuid;
ALTER TABLE cliente    ADD CONSTRAINT cliente_empresa_vinculada_fk    FOREIGN KEY (empresa_vinculada_id, grupo_id) REFERENCES empresa (id, grupo_id);
ALTER TABLE fornecedor ADD CONSTRAINT fornecedor_empresa_vinculada_fk FOREIGN KEY (empresa_vinculada_id, grupo_id) REFERENCES empresa (id, grupo_id);
CREATE INDEX cliente_vinculada_idx    ON cliente (empresa_vinculada_id)    WHERE empresa_vinculada_id IS NOT NULL;
CREATE INDEX fornecedor_vinculada_idx ON fornecedor (empresa_vinculada_id) WHERE empresa_vinculada_id IS NOT NULL;

-- O lançamento de caixa veio de (ou foi para) uma empresa do grupo? Estornos seguem o lançamento original.
CREATE FUNCTION lancamento_intercompany(p_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM lancamento_financeiro l WHERE l.id = p_id AND (
      EXISTS (SELECT 1 FROM baixa_receber b JOIN titulo_receber t ON t.id = b.titulo_id JOIN cliente c ON c.id = t.cliente_id
               WHERE b.lancamento_id = coalesce(l.estorno_de, l.id) AND c.empresa_vinculada_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM pagamento_pagar p JOIN titulo_pagar t ON t.id = p.titulo_id JOIN fornecedor f ON f.id = t.fornecedor_id
               WHERE p.lancamento_id = coalesce(l.estorno_de, l.id) AND f.empresa_vinculada_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM liquidacao_cartao q JOIN baixa_receber b ON b.id = q.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id JOIN cliente c ON c.id = t.cliente_id
               WHERE q.lancamento_id = coalesce(l.estorno_de, l.id) AND c.empresa_vinculada_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM cheque k JOIN baixa_receber b ON b.id = k.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id JOIN cliente c ON c.id = t.cliente_id
               WHERE k.lancamento_id = coalesce(l.estorno_de, l.id) AND c.empresa_vinculada_id IS NOT NULL)
    ))
$$;
GRANT UPDATE (empresa_vinculada_id) ON cliente, fornecedor TO ecv_app;
