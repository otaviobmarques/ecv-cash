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

**Caixa (0006).** `lancamento_financeiro` é o razão: todo dinheiro que entra ou sai de uma conta da loja, imutável (erro se corrige com lançamento contrário, `estorno_de`). `transferencia` entre contas da mesma loja ou
de lojas do grupo (`intercompany`, só o Administrativo). `fechamento_caixa` (dia, por conta) e `fechamento_periodo` (mês, por loja): o banco recusa lançamento em dia ou mês fechado (gatilhos), e o `laudo_protegido` também recusa laudo novo ou alterado em mês fechado.

**A receber (0007).** `titulo_receber` 1:1 com o laudo (nasce no lançamento, acompanha o valor até a primeira baixa ou fatura); `baixa_receber` imutável (principal, multa, juros, perdão; estorno = linha de sinais contrários); `empresa_config` (limite de perdão do Financeiro,
aprovação de contas a pagar, Financeiro vê DRE). Laudo com baixa ou fatura fica travado (`travado_em`).

**Faturas (0008).** `fatura` por loja × cliente × período; valor, cliente, período, vencimento e regra de atraso não mudam depois de emitida (gatilho). Os dados do bloco "Como pagar" são lidos da conta marcada para a fatura na hora de gerar o PDF.

**A pagar (0009).** `titulo_pagar` (rascunho, aguardando aprovação, aprovado, parcial, pago, cancelado; origem manual, recorrência, royalty, comissão, custo de laudo ou rateio), `pagamento_pagar` imutável, `recorrencia_pagar`, `anexo` (comprovantes, até 5 MB, no banco).
`laudo_custo.titulo_pagar_id` marca o custo já apurado. Quem cria não aprova.

**LGPD (0010).** `cliente.anonimizado_em`: pessoa física pode ser anonimizada; os lançamentos financeiros ficam (guarda legal de 5 anos).

**Cartão e cheque (0011).** `liquidacao_cartao` (bruto, taxa, antecipação, líquido, data prevista, status previsto/liquidado/cancelado) e `cheque` (recebido, depositado, compensado, devolvido, cancelado). A baixa nessas formas não entra no caixa na hora.

**Comissões (0012).** `regra_comissao` (por vistoriador e serviço, % ou valor, devida na emissão ou no recebimento), `laudo_comissao` (o que a comissão era no dia do lançamento), `fechamento_comissao` (uma conta a pagar por vistoriador).

**Royalties e impostos (0013).** `regra_repasse` (% sobre bruto, líquido ou recebido, ou valor fixo), `repasse_apuracao` (mês, uma por regra), `aliquota_imposto` (por loja, com vigência sem sobreposição; só dedução do DRE).

**Cobrança (0014).** `regua_cobranca` (por loja, desligada por padrão) e `envio_email` (cada envio ou tentativa, com status; o índice único impede o mesmo aviso automático duas vezes para a mesma fatura).

**Consolidado (0015).** `cliente.empresa_vinculada_id` e `fornecedor.empresa_vinculada_id` dizem que aquele cliente ou fornecedor é outra loja do grupo; a função `lancamento_intercompany` reconhece o dinheiro que veio ou foi para elas. A eliminação é calculada na hora, em cada relatório consolidado.

## Ainda não existe
Balanço gerencial (`saldo_patrimonial_manual`), aprovação de pagamentos em múltiplos níveis, importação por planilha, `solicitacao_titular` (hoje o pedido do titular é atendido por tela e fica na auditoria).

## Estados
Laudo: ativo, cancelado. Título a receber: aberto, parcial, quitado, cancelado ("vencido" é derivado). Fatura: aberta, parcial, paga, cancelada.
Título a pagar: rascunho, aguardando aprovação, aprovado, parcial, pago, cancelado. Cheque: recebido, depositado, compensado, devolvido. Venda no cartão: prevista, liquidada, cancelada.
