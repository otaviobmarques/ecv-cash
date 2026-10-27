# Modelo de dados

Convenções: UUID; `grupo_id` em toda tabela de negócio; FKs compostas `(id, grupo_id)`; dinheiro em `numeric(14,2)` no banco e centavos inteiros no código;
nada é excluído; datas de competência e de caixa separadas.

## Já no banco (migrações 0001 e 0002)
`grupo`, `empresa`, `usuario` (`acesso_rede` = Administrativo), `usuario_empresa_perfil` (Gerente, Financeiro, Vistoriador por loja), `arquivo`,
`tema` (grupo ou empresa), `sessao`, `login_tentativa`, `auditoria_log` (particionada), `usuario_interno`, `sessao_suporte`.
Funções: `app_*()` (contexto), `auth_buscar_usuario`, `auth_buscar_sessao`, `auth_buscar_convite`, `auditoria_criar_particao`.

## Planejado (por módulo)
- **Cadastros:** `cliente` (periodicidade, prazo, multa, juros), `cliente_preco` (vigência; `EXCLUDE` impede sobreposição), `servico`, `servico_custo`,
  `vistoriador`, `vistoriador_empresa`, `forma_pagamento`, `forma_pagamento_empresa` (taxa, prazo, antecipação), `fornecedor`,
  `conta_financeira` (caixa/banco; **banco, agência, conta, tipo, titular, documento, chave PIX, `exibir_na_fatura`**, pedido de alteração pendente),
  `plano_conta`, `aliquota_imposto`.
- **Laudos:** `laudo` (snapshots de preço de tabela, preço cobrado, desconto, `preco_manual`; status ativo/cancelado), `laudo_custo`, `laudo_comissao`,
  `regra_comissao`, `fechamento_comissao`, `regra_repasse`, `repasse_apuracao`.
- **Receber e faturas:** `titulo_receber` (1:1 com laudo), `baixa_receber` (imutável, `estorno_de`), `baixa_lote`, `fatura` (empresa × cliente × período),
  `liquidacao_cartao`, `cheque`.
- **Caixa:** `lancamento_financeiro` (razão de caixa), `transferencia` (marca intercompany), `fechamento_caixa`, `fechamento_periodo`.
- **Pagar:** `titulo_pagar` (origem: manual, recorrência, royalty, comissão, custo de laudo, rateio), `pagamento` (imutável), `recorrencia_pagar`, `rateio_despesa`.
- **Gerencial:** DRE e fluxo derivados; `saldo_patrimonial_manual` para o balanço gerencial.
- **Cobrança e LGPD:** `regua_cobranca`, `envio_email`, `solicitacao_titular`.

## Estados
Laudo: ativo, cancelado. Título a receber: aberto, parcial, quitado, cancelado ("vencido" é derivado). Fatura: aberta, parcial, paga, cancelada.
Título a pagar: rascunho, aguardando aprovação, aprovado, parcial, pago, cancelado. Cheque: recebido, depositado, compensado, devolvido.
