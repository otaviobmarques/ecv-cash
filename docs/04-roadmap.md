# Roadmap

## Fase 1: MVP (operação financeira)
- [x] **Fundação:** monorepo, banco multi-tenant com RLS, login, perfis, convite, auditoria, tema, testes de isolamento.
- [x] Front-end base: shell, login, convite, troca de empresa, tokens ECV Cash, cor por cliente, empresas, usuários, auditoria. Falta: logotipo (envio de arquivo, depende do armazenamento S3).
- [x] Backoffice: login com 2FA, grupos (criar, suspender, reativar), detalhe, log, redefinir acesso, "entrar como" auditado. Falta: criar empresas adicionais e gerir usuários internos pela tela.
- [x] Cadastros, banco e API: clientes e preços (vigência), serviços e custos, vistoriadores, formas de pagamento (taxas por loja), fornecedores, contas financeiras e bancárias com confirmação, plano de contas.
- [x] Cadastros, telas: clientes e preços, fornecedores, serviços e custos, vistoriadores, formas de pagamento (taxas por loja), contas bancárias (pedidos e aprovação), plano de contas.
- [x] Laudos: lançamento (um e em lote de até 50), duplicidade, preço manual com revisão, desconto, edição, cancelamento com pedido e autorização, custos gravados e margem.
- [x] Caixa: razão de caixa, transferências (inclusive entre lojas, só Administrativo), fechamento diário por conta e mensal por loja.
- [x] Contas a receber: título por laudo, baixa total e parcial com multa e juros de atraso, perdão com limite para o Financeiro, estorno, baixa em lote.
- [x] Faturados: fatura por loja × cliente × período, PDF com bloco "Como pagar" e QR Code PIX, baixa total e parcial, cancelamento, números de NF e boleto só como referência.
- [x] Contas a pagar: aprovação (quem cria não aprova), pagamento total e parcial, estorno, recorrência, comprovante, rateio entre lojas, contas geradas pelos custos dos laudos.
- [x] Relatórios essenciais (laudos, recebimentos, inadimplência, pagamentos) com exportação CSV auditada, painel de início por perfil e LGPD básica (acesso do titular e anonimização).

## Fase 2: gestão financeira (concluída)
- [x] Cartão: taxa da operadora, antecipação, previsão de recebimento e liquidação na conta.
- [x] Cheque: recebido, depositado, compensado, devolvido (a devolução reabre o título).
- [x] Comissões do vistoriador: regras, valor gravado no laudo, fechamento que gera conta a pagar.
- [x] Royalties e taxas da franquia: regras, apuração mensal, conta a pagar. Alíquotas de impostos por loja, com vigência.
- [x] Fluxo de caixa realizado e projetado; DRE por competência e por caixa (o Financeiro só vê se o Administrativo liberar).
- [x] E-mail de cobrança: fatura em PDF ao gerar, lembrete antes do vencimento e avisos de atraso, registro de cada envio. Precisa de servidor SMTP configurado (variáveis `SMTP_*`).
- Custos diretos por serviço com vigência: hoje cada laudo guarda os custos do dia do lançamento; a vigência do custo no cadastro fica para depois.

## Fase 3: rede e contábil (em andamento)
- [x] Consolidado da rede: DRE (competência e caixa) e fluxo de caixa de todas as lojas, com eliminação do movimento entre empresas do grupo. O Administrativo marca, em Cadastros > Empresas do grupo, quais clientes e fornecedores são lojas da própria rede.
- [x] Balanço gerencial: caixa, a receber, cartões, cheques e a pagar vêm do sistema; imobilizado, empréstimos e capital são informados à mão por data-base; o patrimônio líquido fecha a conta. Vale por loja ou consolidado.
- [ ] Importação por planilha (clientes, preços, fornecedores).
- [ ] Aprovação de pagamentos em níveis (por faixa de valor).
- [ ] LGPD avançada (prazos de retenção) e logotipo da empresa nos PDFs (depende do armazenamento S3).

## Fase 4: futuro
NFS-e e boleto, importação ou API de laudos, conciliação OFX, app mobile, cobrança de assinatura do SaaS.
