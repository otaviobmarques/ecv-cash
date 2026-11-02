# ECV Cash: instruções para quem desenvolve (humano ou Claude)

Produto: financeiro SaaS multiempresa para ECVs. Leia `docs/00-decisoes-de-produto.md` antes de mudar regra de negócio.
Idioma: tudo em português do Brasil (código de domínio, mensagens, commits). Moeda BRL, datas dd/mm/aaaa na tela.

## Comandos
- `pnpm test` (shared + API, precisa do PostgreSQL local, ver README) · `pnpm typecheck` · `pnpm build`
- Migração nova: arquivo `apps/api/db/migrations/NNNN_descricao.sql`, numerado em sequência. Nunca editar uma migração já aplicada.

## Regras que não se quebram
1. **Dinheiro em centavos inteiros** (`number`), percentuais em pontos-base. Nunca float. Use `@ecv/shared` (`dinheiro.ts`, `juros.ts`).
2. **Isolamento por grupo é do banco (RLS)**, não da aplicação. Toda tabela de negócio leva `grupo_id`, FKs compostas `(id, grupo_id)`,
   RLS ligada e FORÇADA. Todo acesso a dados passa por `DbService.tenant(ctx, fn)`. Tabela nova sem política RLS não entra.
   A aplicação roda como `ecv_app` (sem BYPASSRLS). Teste de isolamento obrigatório para tabela nova (`test/isolamento-banco.test.ts`).
3. **Nada é excluído.** Cancelamento e estorno com motivo; registros de baixa e pagamento são imutáveis (estorno = registro contrário).
   `ecv_app` não tem DELETE em tabela de negócio.
4. **Auditoria na mesma transação** da alteração (`common/auditoria.ts`): quem, o quê, antes/depois, motivo. `auditoria_log` é só inserção.
5. **Permissões** vivem em `packages/shared/src/permissoes.ts` (matriz da Etapa 5). Rota sensível usa `@Requer(...)` e o serviço
   confere a loja (`exigir(acesso, perm, empresaId)`). Esconder item de menu não é proteção.
6. **Snapshots**: laudo grava preço de tabela, preço cobrado, desconto, custos e comissão no momento do lançamento. Reajuste futuro não reescreve o passado.
7. **Sem emissão fiscal nem boleto** no MVP. Só campos de referência (nº NF, nº boleto) e QR Code PIX estático.
8. Interface: tokens do Design System ECV Cash (ver `docs/00-decisoes-de-produto.md`, seção Marca). Estado nunca só por cor: ícone e texto.
9. Mensagens de erro ao usuário: o que houve e como corrigir, sem vazar detalhe interno.

10. **Front**: CSS puro sobre tokens (`packages/ui/src/estilo.css`), sem Tailwind. Diálogos usam `<dialog>` nativo. Cache de consultas: ao entrar ou sair, nunca `queryClient.clear()` (derruba a consulta de sessão); use `removeQueries` dos outros dados.
11. **Convite**: enquanto não houver envio de e-mail (Fase 2), quem cria o convite recebe o link para entregar (`EXPOR_CONVITE=true`). Desligar quando o e-mail entrar.
12. **Suporte ("entrar como")** grava toda ação com `usuario_interno_id`; no log o autor aparece como "Equipe ECV Cash: Nome", nunca como o usuário cliente.

13. **Preço do cliente** nunca é editado: reajuste encerra a vigência anterior na véspera e abre outra (o banco impede sobreposição e alteração). Só o Administrativo reajusta; o Gerente cadastra o primeiro.
14. **Conta que aparece na fatura**: qualquer mudança nos dados bancários, na chave PIX ou na visibilidade exige confirmação do Administrativo com senha; o pedido do Gerente fica pendente e a conta não muda até a aprovação.
15. **Laudo**: o preço do dia, o valor cobrado e os custos ficam gravados no laudo. Valor diferente da tabela só Gerente/Administrativo, com motivo; sem preço cadastrado vale o valor digitado e o laudo entra na fila de revisão. Vistoriador lança só o dia atual e só como ele mesmo. Cancelar = pedido (Vistoriador) + autorização (Gerente/Administrativo, nunca o próprio autor). Margem e custos só com `relatorio.margem`.

16. **Dinheiro só entra e sai pelo razão** (`caixa/razao.ts`, `registrarLancamento`). Lançamento, baixa e pagamento são imutáveis: erro se corrige com registro contrário e motivo. Dia de caixa fechado e mês fechado são recusados pelo banco.
17. **Baixa** (`receber/baixa.ts`) é o único caminho para receber: multa e juros do dia sobre a parte paga, perdão com motivo e limite, laudo travado enquanto houver baixa ou fatura. Cartão e cheque não entram no caixa na baixa (só na liquidação e na compensação).
18. **Contas a pagar**: quem cria não aprova (nem o Administrativo). Comissão, royalty, custo de laudo, recorrência e rateio nascem como contas a pagar pelo mesmo caminho (`pagar/titulo-pagar.ts`).
19. **E-mail** só pelo `Mailer`; sem SMTP o envio é registrado como "e-mail não configurado", nunca como enviado. O mesmo aviso automático não sai duas vezes (índice único).
20. **Migrações novas** seguem a numeração; relatório novo entra em `RELATORIOS` com a permissão certa e, se exporta, passa pela auditoria.

## Estado
Fases 1 e 2 concluídas (banco, API, telas e testes): cadastros, laudos, caixa, a receber, faturados, a pagar, relatórios e painel, LGPD básica, cartão, cheque, comissões, royalties, alíquotas, DRE, fluxo de caixa e cobrança por e-mail. Publicação em `deploy/`. Fase 3 em andamento: consolidado da rede pronto (DRE e fluxo, com eliminação de intercompany). Próximo: balanço gerencial, importação por planilha, aprovação em níveis. Ver `docs/04-roadmap.md`.
