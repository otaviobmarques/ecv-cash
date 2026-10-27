# Arquitetura

Monólito modular em TypeScript. Microsserviços não se justificam na escala (300+ CNPJs, ~80 mil laudos/mês).

| Camada | Escolha |
|---|---|
| API | NestJS (Express), um módulo por contexto de negócio |
| Banco | PostgreSQL 16, **SQL-first** (migrações em SQL puro, consultas explícitas com `pg`) |
| Front (próximo) | React + Vite, TanStack Query/Table, React Hook Form + Zod, Tailwind + Radix sobre os tokens do ECV Cash |
| Filas (futuro) | pg-boss (fila no próprio PostgreSQL; sem Redis) |
| PDF | Chromium headless (HTML/CSS) |
| Arquivos / e-mail | S3 / SES |
| Infra | AWS São Paulo, enxuta: um serviço de aplicação + PostgreSQL gerenciado + S3 + SES |

## Multi-tenancy
Banco e esquema compartilhados; tenant = **grupo**. Toda tabela de negócio tem `grupo_id` e FKs compostas `(id, grupo_id)`.
**Row-Level Security ligada e forçada.** A API informa o contexto por transação (`app.grupo_id`, `app.usuario_id`, `app.rede`, `app.empresas`)
e o banco filtra por grupo e por loja. Esquecer um `WHERE` não vaza dado: sem contexto nenhuma linha aparece.
Três papéis: `ecv_owner` (migrações), `ecv_app` (runtime, sem BYPASSRLS, sem DELETE em tabela de negócio) e `ecv_definer`
(sem login, dono de 3 funções de login que precisam achar usuário e sessão antes de o grupo ser conhecido).
Detalhes e a razão da escolha em `adr/0001-sql-first-e-rls.md`.

## Integridade financeira
Valores em centavos inteiros; percentuais em pontos-base; arredondamento meio para cima. Nada é excluído. Baixas e pagamentos são
registros imutáveis (estorno é registro de sinal contrário). Snapshots no laudo. Fechamento de caixa e de período bloqueia edição.
Juros e multa calculados na consulta e gravados como snapshot na baixa.

## Autenticação
Sessão em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; token aleatório de 256 bits, só o hash fica no banco; expira em 12 h.
Senha com argon2id. Bloqueio após 5 falhas em 15 min (por e-mail, hash no banco). Convite de uso único com validade de 7 dias.
Mutações exigem `Origin` autorizada (defesa de CSRF). 2FA obrigatório no backoffice (a implementar).

## Auditoria
`auditoria_log`: só inserção (permissões, gatilho e RLS), particionada por mês, gravada na mesma transação da alteração.
O Gerente só enxerga eventos das próprias lojas. Criar partições futuras: `SELECT auditoria_criar_particao(ano, mes)` (agendar). Hoje há partições até dez/2027.

## Backoffice
Aplicação e login separados do cliente (tabela `usuario_interno`). "Entrar como" cria `sessao_suporte` com motivo, prazo e registro no log do cliente.

## Ambientes e qualidade
dev, staging, produção. CI roda migrações, typecheck e testes contra PostgreSQL real. Teste de isolamento entre grupos é obrigatório para tabela nova.
