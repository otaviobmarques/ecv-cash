# Matriz de permissões

A fonte executável é `packages/shared/src/permissoes.ts` (testada em `shared.test.ts`). Esta página resume a decisão.

Legenda: ✔ permitido · ◐ com condição · — sem acesso. Escopo: Administrativo = grupo todo; Gerente, Financeiro e Vistoriador = lojas atribuídas; Vistoriador = só os próprios laudos.

| Área | Administrativo | Gerente | Financeiro | Vistoriador |
|---|:-:|:-:|:-:|:-:|
| Criar e inativar empresas | ✔ | — | — | — |
| Editar dados da empresa | ✔ | ◐ própria loja | — | — |
| Usuários | ✔ | ◐ própria loja, só Financeiro e Vistoriador | — | — |
| Tema (logo e cores) | ✔ grupo e lojas | ◐ própria loja | — | — |
| Plano de contas, alíquotas, royalties | ✔ | ver | ver | — |
| Log de auditoria | ✔ | ◐ própria loja | — | — |
| Clientes | ✔ | ✔ | ver | ver nome |
| Preço do cliente | ✔ reajusta | ◐ cadastra o primeiro | ver | ver no lançamento |
| Serviços, formas de pagamento | ✔ | ver | ver | ver só nome (serviço e forma, para lançar) |
| Lançar laudo | ✔ | ✔ | — | ✔ |
| Editar laudo | ✔ | ✔ | — | ◐ próprio, no dia, antes de faturar |
| Desconto / alterar preço de tabela | ✔ | ✔ | — | — |
| Autorizar cancelamento de laudo | ✔ | ✔ | — | solicita |
| Baixar títulos e faturas | ✔ | ✔ | ✔ | — |
| Estornar baixa | ✔ | ✔ | ◐ período aberto, com motivo | — |
| Contas a pagar: criar e pagar | ✔ | ✔ | ✔ | — |
| Contas a pagar: aprovar | ✔ | ✔ | — (configurável) | — |
| Rateio entre empresas, intercompany, reabrir período | ✔ | — | — | — |
| Ajuste manual no caixa | ✔ | ✔ | — | — |
| Fechar caixa | ✔ | ✔ | ✔ | — |
| Fechar período mensal | ✔ | ✔ | — | — |
| Relatórios operacionais e financeiros, fluxo de caixa | ✔ | ✔ | ✔ | — |
| DRE e Balanço | ✔ | ✔ | ◐ se liberado | — |
| Margem, custos, comissões | ✔ | ✔ | — | — |
| Exportar PDF/Excel | ✔ | ✔ | ✔ | — |

Backoffice (equipe interna): Plataforma (tudo), Operações (grupos e empresas), Suporte (log, redefinir acesso, "entrar como" com motivo).

Regras gerais: ação sensível exige motivo e gera log; período fechado bloqueia alteração; CPF/CNPJ mascarado para o Vistoriador; quem cria pagamento não aprova.

Complementos da Fase 2: o Financeiro vê o DRE só se o Administrativo liberar nas regras da loja (`financeiro_ve_dre`) e aprova contas a pagar só se liberado (`financeiro_aprova_pagar`); o limite de perdão de multa e juros do Financeiro por baixa é configurável (padrão R$ 50,00). Quem cria uma conta a pagar nunca a aprova.
Cartões, cheques, comissões, royalties e alíquotas seguem a mesma divisão: o Administrativo configura royalties e alíquotas; Gerente e Administrativo configuram e fecham comissões; Financeiro consulta.
