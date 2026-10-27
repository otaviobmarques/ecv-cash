# ADR 0001: SQL-first com isolamento por RLS

**Contexto.** O sistema é financeiro e multi-tenant (centenas de CNPJs, grupos independentes). Vazar dado entre grupos é o pior
defeito possível. Há também muitas consultas de relatório e restrições que ORMs expressam mal (intervalos de vigência sem sobreposição,
partições, RLS, funções de login com dono especial).

**Decisão.** Migrações em SQL puro e consultas explícitas com `pg`, sem ORM. O isolamento é do banco: RLS forçada em toda tabela de
negócio, contexto por transação (`set_config(..., true)`), papel de runtime sem BYPASSRLS e sem DELETE. A aplicação ainda checa permissão,
mas um filtro esquecido não vaza dados.

**Consequências.** Mais SQL escrito à mão e tipos de linha declarados manualmente (um gerador de tipos pode entrar depois).
Em compensação, o teste de isolamento fala SQL direto e prova a garantia sem depender de a API estar certa. Tabela nova sem política RLS não entra.
Em nuvem gerenciada, o papel `ecv_definer` com BYPASSRLS precisa ser criado pelo administrador do banco (ver `scripts/db-bootstrap.sh`).

**Alternativas descartadas.** Prisma/Drizzle (RLS e restrições avançadas exigem SQL manual de qualquer forma); schema ou banco por cliente (migração em centenas de bancos).
