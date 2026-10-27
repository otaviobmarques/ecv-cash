# Modelo de dados

Convenções: UUID; `grupo_id` em toda tabela de negócio; FKs compostas `(id, grupo_id)`; dinheiro em `numeric(14,2)` no banco e centavos inteiros no código;
nada é excluído; datas de competência e de caixa separadas.

## Já no banco (migrações 0001 e 0002)
`grupo`, `empresa`, `usuario` (`acesso_rede` = Administrativo), `usuario_empresa_perfil` (Gerente, Financeiro, Vistoriador por loja), `arquivo`,
`tema` (grupo ou empresa), `sessao`, `login_tentativa`, `auditoria_log` (particionada), `usuario_interno`, `sessao_suporte`.
Funções: `app_*()` (contexto), `auth_buscar_usuario`, `auth_buscar_sessao`, `auth_buscar_convite`, `auditoria_criar_particao`, `bo_listar_grupos`.
Backoffice (migração 0003): `sessao_interna`, ticket de suporte em `sessao_suporte`, `sessao.sessao_suporte_id`.

**Cadastros (migração 0004).** Do grupo, valem para todas as lojas: `plano_conta`, `servico`, `servico_custo`, `fornecedor`, `cliente`, `cliente_preco`, `forma_pagamento`.
Da loja (isolamento por loja): `forma_pagamento_empresa`, `vistoriador` (visível pela lotação) e `vistoriador_empresa`, `conta_financeira`, `conta_financeira_pedido`.
- `cliente_preco`: vigências nunca se sobrepõem (`EXCLUDE ... gist`) e um preço gravado não muda (gatilho): só dá para encerrar a vigência. Reajuste = encerrar na véspera e abrir a nova.
- `conta_financeira`: a conta que aparece na fatura (`exibir_na_fatura`) só existe completa (CHECK no banco). Mudança em conta exibida passa por `conta_financeira_pedido` e confirmação do Administrativo com senha.
- Todo grupo novo recebe o plano de contas e as formas de pagamento padrão (`semearPadroes`).

**Laudos (migração 0005).** Da loja (isolamento por loja): `laudo` e `laudo_custo`.
- `laudo` guarda o preço de tabela do dia, o valor cobrado e se o valor foi digitado (`preco_manual`, só quando o cliente não tinha preço). Reajuste futuro não mexe nele.
- Placa validada no banco (padrão antigo e Mercosul); nº do laudo único entre os ativos da loja; duplicidade (loja + placa + serviço + data) é aviso na aplicação, que o Gerente e o Administrativo liberam com motivo.
- `laudo_custo` é o retrato dos custos do serviço no lançamento (recalculado só quando o valor ou o serviço mudam; os anteriores ficam inativos). Margem e custos só aparecem para quem tem `relatorio.margem`.
- Gatilho `laudo_protegido`: laudo cancelado não muda mais; laudo travado (futuramente faturado ou baixado) não muda valor, preço, cliente, serviço, data, placa, forma nem loja.
- Cancelamento: o Vistoriador pede, o Gerente ou o Administrativo autoriza (não o próprio autor do pedido); motivo sempre registrado.

## Planejado (por módulo)
- **Cadastros que faltam:** `aliquota_imposto`.
- **Laudos que faltam:** `laudo_comissao`,
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
