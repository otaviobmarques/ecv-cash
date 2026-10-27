import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { criarCenario, gerarCnpj, subirApp } from './helpers';

/**
 * O isolamento é do banco, não da aplicação. Estes testes falam SQL direto, como se a API
 * tivesse esquecido um filtro, e conferem que ainda assim nada vaza.
 */
describe('isolamento no banco (RLS)', () => {
  let app: INestApplication;
  let db: DbService;
  let cen: Awaited<ReturnType<typeof criarCenario>>;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
  });
  afterAll(() => app.close());

  it('sem contexto nenhuma linha aparece', async () => {
    const n = await db.semTenant(async (c) => Number((await c.query('SELECT count(*) AS n FROM empresa')).rows[0].n));
    expect(n).toBe(0);
  });

  it('o Administrativo do grupo A vê só as empresas de A, mesmo sem WHERE', async () => {
    const r = await db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT id FROM empresa'));
    expect(r.rows.map((x) => x.id).sort()).toEqual([...cen.A.empresaIds].sort());
  });

  it('não lê, não altera e não insere dados do grupo B estando no grupo A', async () => {
    const ctxA = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
    const [empresaB] = cen.B.empresaIds;
    const lido = await db.tenant(ctxA, (c) => c.query('SELECT id FROM empresa WHERE id = $1', [empresaB]));
    expect(lido.rowCount).toBe(0);
    const alterado = await db.tenant(ctxA, (c) => c.query(`UPDATE empresa SET nome_fantasia = 'invadido' WHERE id = $1`, [empresaB]));
    expect(alterado.rowCount).toBe(0);
    await expect(
      db.tenant(ctxA, (c) =>
        c.query(
          `INSERT INTO empresa (grupo_id, cnpj, razao_social, nome_fantasia, uf, cidade, regime)
           VALUES ($1,$2,'x','x','SP','x','SIMPLES_NACIONAL')`,
          [cen.B.grupoId, gerarCnpj()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('usuários do grupo B não aparecem para o grupo A', async () => {
    const r = await db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT id FROM usuario'));
    for (const id of cen.B.usuarioIds) expect(r.rows.map((x) => x.id)).not.toContain(id);
  });

  it('usuário de loja só enxerga a própria loja, sem filtro algum', async () => {
    const [a1] = cen.A.empresaIds;
    const r = await db.tenant({ grupoId: cen.A.grupoId, rede: false, empresas: [a1!] }, (c) => c.query('SELECT id FROM empresa'));
    expect(r.rows.map((x) => x.id)).toEqual([a1]);
  });

  it('o contexto vale só dentro da transação', async () => {
    await db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT 1'));
    const n = await db.semTenant(async (c) => Number((await c.query('SELECT count(*) AS n FROM empresa')).rows[0].n));
    expect(n).toBe(0);
  });

  it('chave estrangeira composta impede lotação em empresa de outro grupo', async () => {
    const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
    await expect(
      db.tenant(ctx, (c) =>
        c.query('INSERT INTO usuario_empresa_perfil (usuario_id, empresa_id, grupo_id, perfil) VALUES ($1,$2,$3,$4)', [
          cen.A.usuarioIds[0], cen.B.empresaIds[0], cen.A.grupoId, 'GERENTE',
        ]),
      ),
    ).rejects.toBeDefined();
  });

  it('auditoria é somente inserção, nem para a própria aplicação', async () => {
    const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
    await db.tenant(ctx, (c) =>
      c.query(`INSERT INTO auditoria_log (grupo_id, acao, entidade) VALUES ($1,'teste','teste')`, [cen.A.grupoId]),
    );
    await expect(db.tenant(ctx, (c) => c.query(`UPDATE auditoria_log SET acao = 'x'`))).rejects.toBeDefined();
    await expect(db.tenant(ctx, (c) => c.query(`DELETE FROM auditoria_log`))).rejects.toBeDefined();
  });

  it('a aplicação não consegue apagar nada de negócio', async () => {
    const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
    for (const t of ['empresa', 'usuario', 'tema', 'sessao']) {
      await expect(db.tenant(ctx, (c) => c.query(`DELETE FROM ${t}`)), t).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('o papel da aplicação não ignora o isolamento', async () => {
    const r = await db.semTenant((c) => c.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`));
    expect(r.rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
  });

  it('um grupo novo só pode ser criado com o próprio id no contexto', async () => {
    const id = randomUUID();
    await expect(
      db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query(`INSERT INTO grupo (id, nome) VALUES ($1, 'intruso')`, [id])),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
