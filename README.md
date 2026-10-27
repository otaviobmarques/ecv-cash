# ECV Cash

Sistema financeiro SaaS multiempresa para ECVs (Empresas Credenciadas de Vistoria): laudos, contas a receber e a pagar,
faturados, caixa, relatórios e visão contábil/gerencial. Desenvolvido pela agência REDBOX.

> Estado: **Fundação** pronta (isolamento por grupo, login, perfis, auditoria, tema). Próximo módulo: cadastros e laudos.
> Roadmap em [`docs/04-roadmap.md`](docs/04-roadmap.md).

## Documentação
- [`docs/00-decisoes-de-produto.md`](docs/00-decisoes-de-produto.md): o que foi decidido nas etapas 1 a 6, em linguagem de negócio.
- [`docs/01-arquitetura.md`](docs/01-arquitetura.md): stack, multi-tenancy, integridade financeira.
- [`docs/02-modelo-de-dados.md`](docs/02-modelo-de-dados.md): entidades e o que já está no banco.
- [`docs/03-permissoes.md`](docs/03-permissoes.md): matriz por perfil. A fonte executável é `packages/shared/src/permissoes.ts`.
- [`docs/prototipo/`](docs/prototipo/ecv-cash-prototipo.html): protótipo navegável das telas (abrir no navegador).

## Rodar localmente
Requisitos: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
# 1) papéis e banco (uma vez, como superusuário do Postgres)
sudo -u postgres env ECV_OWNER_PW=owner ECV_APP_PW=app scripts/db-bootstrap.sh
# 2) variáveis e migrações
cp apps/api/.env.example apps/api/.env
export DATABASE_URL_OWNER=postgres://ecv_owner:owner@localhost:5432/ecv_cash
pnpm db:migrate
# 3) dados de exemplo (só desenvolvimento) e API
export DATABASE_URL=postgres://ecv_app:app@localhost:5432/ecv_cash
pnpm db:seed
pnpm dev:api
```

Usuários do seed (senha `Senha-de-teste-1`): `admin@`, `gerente@`, `financeiro@` e `vistoriador@exemplo.local`.

## Testes
```bash
pnpm test        # shared (regras puras) + API (contra PostgreSQL real, incluindo isolamento entre grupos)
pnpm typecheck
```
Os testes da API precisam do banco do passo 1. Eles criam grupos próprios a cada execução.

## Estrutura
```
apps/api          API NestJS (monólito modular) + migrações SQL (apps/api/db/migrations)
packages/shared   regras puras compartilhadas: permissões, dinheiro, juros, contraste, validações
docs/             decisões, arquitetura, modelo de dados, protótipo
scripts/          bootstrap do banco
```
