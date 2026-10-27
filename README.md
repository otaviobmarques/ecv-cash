# ECV Cash

Sistema financeiro SaaS multiempresa para ECVs (Empresas Credenciadas de Vistoria): laudos, contas a receber e a pagar,
faturados, caixa, relatórios e visão contábil/gerencial. Desenvolvido pela agência REDBOX.

> Estado: **Fundação**, **app dos clientes** (login, empresas, usuários, aparência, auditoria) e **backoffice** (grupos, 2FA, suporte) prontos. Próximo módulo: cadastros e laudos.
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
pnpm dev:api          # API em http://localhost:3000
pnpm dev:web          # app dos clientes em http://localhost:5173
pnpm dev:backoffice   # backoffice em http://localhost:5174
```

Usuários do seed (senha `Senha-de-teste-1`): `admin@`, `gerente@`, `financeiro@` e `vistoriador@exemplo.local`.
Use sempre `localhost` no navegador (a API só aceita essa origem com cookie).

**Primeiro usuário do backoffice** (equipe interna): `pnpm --filter @ecv/api bo:criar-interno "Seu Nome" voce@empresa.com PLATAFORMA`.
Ele imprime uma senha provisória. No primeiro login o backoffice pede para ligar o aplicativo autenticador (2FA).

**Verificação no navegador:** `pnpm e2e <senha provisória>` percorre criar grupo, convite, login, telas e suporte (ver `e2e/smoke.ts`).

## Testes
```bash
pnpm test        # shared (regras puras) + API (contra PostgreSQL real, incluindo isolamento entre grupos)
pnpm typecheck
```
Os testes da API precisam do banco do passo 1. Eles criam grupos próprios a cada execução.

## Estrutura
```
apps/api          API NestJS (monólito modular) + migrações SQL (apps/api/db/migrations)
apps/web          app dos clientes (React + Vite)
apps/backoffice   backoffice da equipe interna (React + Vite)
packages/ui       Design System ECV Cash: tokens, componentes, cliente da API, tema
packages/shared   regras puras compartilhadas: permissões, dinheiro, juros, contraste, validações
e2e/              verificação ponta a ponta no navegador (manual)
docs/             decisões, arquitetura, modelo de dados, protótipo
scripts/          bootstrap do banco
```
