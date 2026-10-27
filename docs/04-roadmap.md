# Roadmap

## Fase 1: MVP (operação financeira)
- [x] **Fundação:** monorepo, banco multi-tenant com RLS, login, perfis, convite, auditoria, tema, testes de isolamento.
- [ ] Front-end base: shell, login, troca de empresa, tokens ECV Cash, tema por cliente.
- [ ] Backoffice simples: criar e suspender grupos e empresas, "entrar como" auditado.
- [ ] Cadastros: clientes e preços (vigência), serviços e custos, vistoriadores, formas de pagamento, fornecedores, contas financeiras e bancárias, plano de contas.
- [ ] Laudos: lançamento, lote, duplicidade, preço manual, desconto, cancelamento.
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
