# Decisões de produto (etapas 1 a 6)

Registro do que foi combinado com o cliente. Onde diz "default", foi sugestão aceita.

## Negócio
- **Escopo fiscal:** só financeiro interno. Sem NF-e/NFS-e nem boleto no MVP. Campos de referência para nº de NF e de boleto emitidos fora.
- **Impostos:** alíquotas configuráveis por empresa, com vigência (ISS, PIS/COFINS, Simples). Sem apuração fiscal. Entram como dedução no DRE.
- **Royalties e taxas da franquia:** regras em % ou R$ fixo por empresa; base de cálculo bruto (default), líquido ou recebido; geram conta a pagar.
- **Comissão do vistoriador:** opcional por empresa, em % ou R$; snapshot no laudo; fechamento por período gera conta a pagar. Devida na emissão (default) ou no recebimento.
- **Custos diretos por serviço:** abertos e configuráveis (R$ ou %), com vigência; margem por laudo; podem gerar conta a pagar (default: só gerencial).
- **Laudos:** lançamento manual (sem integração no MVP), com lançamento em lote. Obrigatórios: placa, data, cliente, serviço, vistoriador, preço, forma de pagamento. Opcionais: nº do laudo, chassi, observação.
- **Preço:** vem da tabela do cliente por serviço, com vigência e histórico. **Cliente e preço são do grupo e valem para todas as lojas.** Cliente sem preço: alerta e digitação manual (qualquer perfil que lança), laudo marcado "preço manual" para revisão do gerente. Desconto e alteração do preço de tabela: só Gerente e Administrativo, com motivo. O Gerente cadastra o primeiro preço; só o Administrativo reajusta.
- **Duplicidade:** aviso por placa + serviço + data + empresa. Nº do laudo, quando informado, é único por empresa.
- **Cancelamento de laudo:** só o Gerente (ou Administrativo) autoriza, com motivo. Vistoriador pode solicitar.

## Financeiro
- **Faturas:** uma por empresa × cliente × período (cliente em duas lojas recebe duas faturas). Periodicidade semanal, quinzenal ou mensal por cliente. Vencimento 10 dias, multa 2%, juros 1% ao mês pro rata por dia (defaults, configuráveis por cliente). Gera PDF com logo da loja. Baixa individual ou em lote, total ou parcial.
- **Contas bancárias da empresa** (banco, agência, conta, titular, chave PIX), com "mostrar na fatura": aparecem no bloco "Como pagar" da fatura, com QR Code PIX estático (valor da fatura com encargos do dia) e Pix copia e cola. A baixa continua manual. Mudar conta que aparece na fatura exige confirmação do Administrativo, com senha, aviso por e-mail e histórico. O pedido do Gerente fica pendente e a fatura mantém os dados antigos até a aprovação.
- **Cartão:** taxa da operadora, prazo e antecipação por empresa e forma de pagamento; previsão de recebimento no fluxo de caixa.
- **Cheque:** status recebido, depositado, compensado, devolvido.
- **Caixa:** contas financeiras (caixa e bancos), fechamento de caixa diário e fechamento de período mensal.
- **Contas a pagar:** recorrência, rateio entre lojas (só Administrativo), anexo de comprovante, aprovação (quem cria não aprova; configurável por empresa).
- **Intercompany:** transferências e custos entre empresas do grupo, eliminados na visão consolidada.
- **Relatórios contábeis:** DRE e fluxo de caixa por competência e por caixa. Balanço gerencial (sem partida dobrada; estrutura pronta). Plano de contas simples e editável criado por grupo.
- **Cobrança por e-mail** (Fase 2): fatura em PDF e lembretes de vencimento e atraso.

## Plataforma
- SaaS multi-tenant; tenant = grupo/franqueado. Escala alvo: 300+ CNPJs, ~80 mil laudos/mês.
- Acesso só por PC (desktop-first). Só PT-BR e BRL. Sem migração de dados (começa do zero, com importação de cadastros por planilha).
- LGPD: acesso e exportação auditados, retenção definida, anonimização por solicitação.
- **Backoffice** (sistema separado, 2FA obrigatório) no MVP, versão simples: criar e suspender grupos e empresas, primeiro Administrativo, log, "entrar como" com motivo, prazo de 30 min e registro no log do cliente.
- **Aparência por cliente:** logo e cor principal por grupo ou empresa (herança), contraste validado (mínimo 3:1 com o fundo; texto troca para escuro abaixo de 4,5:1 com branco). Cores de erro, aviso, sucesso e gráficos não mudam.
- Crédito "Desenvolvido por REDBOX" discreto no rodapé do sistema e do backoffice; não aparece em PDFs e relatórios.

## Perfis
Administrativo (rede), Gerente (própria loja), Financeiro, Vistoriador. Matriz completa em `03-permissoes.md`.
- Gerente gerencia usuários da própria loja (só Financeiro e Vistoriador).
- Financeiro não vê DRE e Balanço por padrão (liberável pelo Administrativo) e não aprova pagamentos por padrão.
- Vistoriador edita o próprio laudo no mesmo dia, antes de faturar, baixar ou fechar o caixa, e pode solicitar cancelamento.

## Marca (Design System ECV Cash v1.0)
Verde profundo `#104B3A` (base, títulos, botão primário; hover `#0B3A2C`), Esmeralda `#008B49` (destaques), Verde-claro `#80BC43` (acento, nunca com texto branco),
Marfim `#F7F8F2` (fundo), Branco, Texto `#18382E`, Texto secundário `#52675F`, Erro `#B42318`, Aviso `#805600`, Foco `#005FCC` (contorno 3 px).
Tipografia DejaVu Sans 400/700. Espaçamento base 4 px. Raios: campos 8, botões 12, cards 16. Controles com mínimo de 48 px de altura. Contraste mínimo 4,5:1.
Paleta categórica de gráficos validada: `#008B49`, `#2F6FD0`, `#C47A00`, `#9A5BC0`, `#D1462F`. Ícones de linha, traço 1,8 px. O logo é raster no kit; pedir SVG, símbolo isolado e versão monocromática.
