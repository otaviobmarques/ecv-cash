# Roadmap

## Fase 1: MVP (operação financeira)
- [x] **Fundação:** monorepo, banco multi-tenant com RLS, login, perfis, convite, auditoria, tema, testes de isolamento.
- [x] Front-end base: shell, login, convite, troca de empresa, tokens ECV Cash, cor por cliente, empresas, usuários, auditoria. Falta: logotipo (envio de arquivo, depende do armazenamento S3).
- [x] Backoffice: login com 2FA, grupos (criar, suspender, reativar), detalhe, log, redefinir acesso, "entrar como" auditado. Falta: criar empresas adicionais e gerir usuários internos pela tela.
- [x] Cadastros, banco e API: clientes e preços (vigência), serviços e custos, vistoriadores, formas de pagamento (taxas por loja), fornecedores, contas financeiras e bancárias com confirmação, plano de contas.
- [x] Cadastros, telas: clientes e preços, fornecedores, serviços e custos, vistoriadores, formas de pagamento (taxas por loja), contas bancárias (pedidos e aprovação), plano de contas.
- [x] Laudos: lançamento (um e em lote de até 50), duplicidade, preço manual com revisão, desconto, edição, cancelamento com pedido e autorização, custos gravados e margem. Falta: gerar o título a receber (próximo módulo).
- [ ] Contas a receber: título por laudo, baixa total e parcial, estorno.
- [ ] Faturados: fatura por empresa × cliente × período, PDF, QR PIX, baixa em lote, juros e multa.
- [ ] Contas a pagar: títulos, recorrência simples, comprovante, aprovação.
- [ ] Caixa: contas, movimentos, fechamento diário.
- [ ] Relatórios essenciais com exportação e dashboard básico. LGPD básica.

## Fase 2: gestão financeira
Cartão (taxa, antecipação, previsão), cheque, fluxo de caixa, DRE, custos diretos e margem, comissões, royalties, alíquotas, e-mail de cobrança.

## Fase 3: rede e contábil
Consolidado da rede com intercompany, rateio, balanço gerencial, aprovação de pagamentos, importação por planilha, LGPD avançada.

## Fase 4: futuro
NFS-e e boleto, importação ou API de laudos, conciliação OFX, app mobile, cobrança de assinatura do SaaS.
