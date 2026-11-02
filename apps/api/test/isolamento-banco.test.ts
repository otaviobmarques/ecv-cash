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

  describe('tabelas de cadastro', () => {
    const TABELAS = ['plano_conta', 'servico', 'fornecedor', 'servico_custo', 'cliente', 'cliente_preco', 'forma_pagamento', 'forma_pagamento_empresa',
      'vistoriador', 'vistoriador_empresa', 'conta_financeira', 'conta_financeira_pedido'];
    const rede = (g: string) => ({ grupoId: g, rede: true, empresas: [] as string[] });

    it('o grupo B não enxerga nada do grupo A, e sem contexto nada aparece, em todas as tabelas', async () => {
      const [a1, a2] = cen.A.empresaIds;
      await db.tenant(rede(cen.A.grupoId), async (c) => {
        const cli = (await c.query(`INSERT INTO cliente (grupo_id, tipo_pessoa, nome) VALUES ($1,'PJ','Cliente do A') RETURNING id`, [cen.A.grupoId])).rows[0].id;
        const srv = (await c.query(`INSERT INTO servico (grupo_id, nome) VALUES ($1,'Serviço do A') RETURNING id`, [cen.A.grupoId])).rows[0].id;
        await c.query(`INSERT INTO cliente_preco (grupo_id, cliente_id, servico_id, valor_centavos, vigencia_ini) VALUES ($1,$2,$3,1000,'2026-01-01')`, [cen.A.grupoId, cli, srv]);
        await c.query(`INSERT INTO fornecedor (grupo_id, nome) VALUES ($1,'Fornecedor do A')`, [cen.A.grupoId]);
        await c.query(`INSERT INTO servico_custo (grupo_id, servico_id, descricao, tipo, valor_centavos) VALUES ($1,$2,'Taxa','VALOR',100)`, [cen.A.grupoId, srv]);
        const forma = (await c.query(`INSERT INTO forma_pagamento (grupo_id, nome, tipo) VALUES ($1,'Forma do A','OUTRA') RETURNING id`, [cen.A.grupoId])).rows[0].id;
        await c.query(`INSERT INTO forma_pagamento_empresa (grupo_id, forma_id, empresa_id, taxa_bp) VALUES ($1,$2,$3,100)`, [cen.A.grupoId, forma, a1]);
        const vis = (await c.query(`INSERT INTO vistoriador (grupo_id, nome) VALUES ($1,'Vistoriador do A') RETURNING id`, [cen.A.grupoId])).rows[0].id;
        await c.query(`INSERT INTO vistoriador_empresa (vistoriador_id, empresa_id, grupo_id) VALUES ($1,$2,$3)`, [vis, a1, cen.A.grupoId]);
        const conta = (await c.query(`INSERT INTO conta_financeira (grupo_id, empresa_id, nome, tipo) VALUES ($1,$2,'Caixa A1','CAIXA') RETURNING id`, [cen.A.grupoId, a1])).rows[0].id;
        await c.query(`INSERT INTO conta_financeira_pedido (grupo_id, empresa_id, conta_id, dados, solicitado_por) VALUES ($1,$2,$3,'{}',$4)`, [cen.A.grupoId, a1, conta, cen.A.usuarioIds[1]]);
        await c.query(`INSERT INTO conta_financeira (grupo_id, empresa_id, nome, tipo) VALUES ($1,$2,'Caixa A2','CAIXA')`, [cen.A.grupoId, a2]);
      });
      for (const t of TABELAS) {
        const grupos = async (g: string) => (await db.tenant(rede(g), (c) => c.query(`SELECT DISTINCT grupo_id FROM ${t}`))).rows.map((r) => r.grupo_id);
        expect(await grupos(cen.A.grupoId), `${t} no grupo A`).toEqual([cen.A.grupoId]);
        expect((await grupos(cen.B.grupoId)).filter((g) => g === cen.A.grupoId), `${t} no grupo B`).toEqual([]);
        const semContexto = await db.semTenant(async (c) => Number((await c.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n));
        expect(semContexto, `${t} sem contexto`).toBe(0);
      }
    });

    it('usuário de loja só enxerga as contas, vistoriadores e taxas da própria loja', async () => {
      const [a1, a2] = cen.A.empresaIds;
      await db.tenant(rede(cen.A.grupoId), async (c) => {
        const vis2 = (await c.query(`INSERT INTO vistoriador (grupo_id, nome) VALUES ($1,'Só da loja 2') RETURNING id`, [cen.A.grupoId])).rows[0].id;
        await c.query(`INSERT INTO vistoriador_empresa (vistoriador_id, empresa_id, grupo_id) VALUES ($1,$2,$3)`, [vis2, a2, cen.A.grupoId]);
      });
      const loja1 = { grupoId: cen.A.grupoId, rede: false, empresas: [a1!] };
      const contas = await db.tenant(loja1, (c) => c.query('SELECT empresa_id FROM conta_financeira'));
      expect(new Set(contas.rows.map((r) => r.empresa_id))).toEqual(new Set([a1]));
      const vist = await db.tenant(loja1, (c) => c.query('SELECT nome FROM vistoriador'));
      expect(vist.rows.map((r) => r.nome)).toContain('Vistoriador do A');
      expect(vist.rows.map((r) => r.nome)).not.toContain('Só da loja 2');
      const pedidos = await db.tenant({ grupoId: cen.A.grupoId, rede: false, empresas: [a2!] }, (c) => c.query('SELECT 1 FROM conta_financeira_pedido'));
      expect(pedidos.rowCount).toBe(0); // o pedido é da loja 1
      // cliente, serviço e preço são do grupo: a loja vê
      const clientes = await db.tenant(loja1, (c) => c.query('SELECT nome FROM cliente'));
      expect(clientes.rows.map((r) => r.nome)).toContain('Cliente do A');
    });

    it('a aplicação não apaga nada de cadastro, só a lotação do vistoriador', async () => {
      for (const t of TABELAS.filter((x) => x !== 'vistoriador_empresa')) {
        await expect(db.tenant(rede(cen.A.grupoId), (c) => c.query(`DELETE FROM ${t}`)), t).rejects.toMatchObject({ code: '42501' });
      }
    });

    it('chave estrangeira composta impede ligar cadastros de grupos diferentes', async () => {
      const [a1] = cen.A.empresaIds;
      // cliente e serviço do A sem nenhum preço, para a chave estrangeira ser a única barreira
      const { clienteA, servicoA } = await db.tenant(rede(cen.A.grupoId), async (c) => ({
        clienteA: (await c.query(`INSERT INTO cliente (grupo_id, tipo_pessoa, nome) VALUES ($1,'PJ','Cliente sem preço do A') RETURNING id`, [cen.A.grupoId])).rows[0].id,
        servicoA: (await c.query(`INSERT INTO servico (grupo_id, nome) VALUES ($1,'Serviço sem preço do A') RETURNING id`, [cen.A.grupoId])).rows[0].id,
      }));
      // preço no grupo B apontando para cliente e serviço do grupo A
      await expect(db.tenant(rede(cen.B.grupoId), (c) => c.query(
        `INSERT INTO cliente_preco (grupo_id, cliente_id, servico_id, valor_centavos, vigencia_ini) VALUES ($1,$2,$3,1000,'2026-01-01')`, [cen.B.grupoId, clienteA, servicoA]))).rejects.toMatchObject({ code: '23503' });
      // conta financeira do grupo B em empresa do grupo A
      await expect(db.tenant(rede(cen.B.grupoId), (c) => c.query(
        `INSERT INTO conta_financeira (grupo_id, empresa_id, nome, tipo) VALUES ($1,$2,'Invasora','CAIXA')`, [cen.B.grupoId, a1]))).rejects.toMatchObject({ code: '23503' });
    });
  });

  describe('assinatura do SaaS', () => {
    it('contrato e mensalidades de um grupo não aparecem, não se alteram e não se apagam por outro', async () => {
      const plano = (await db.semTenant((c) => c.query(`INSERT INTO plano_saas (nome, valor_base_centavos) VALUES ($1, 1000) RETURNING id`, [`Iso ${randomUUID()}`]))).rows[0].id;
      const rede = (g: string) => ({ grupoId: g, rede: true, empresas: [] as string[] });
      const ass = await db.tenant(rede(cen.A.grupoId), async (c) => {
        const a = (await c.query(`INSERT INTO assinatura_saas (grupo_id, plano_id, valor_base_centavos, empresas_incluidas, valor_empresa_adicional_centavos, dia_vencimento, inicio)
                                  VALUES ($1,$2,1000,1,0,10,'2026-01-01') RETURNING id`, [cen.A.grupoId, plano])).rows[0].id;
        await c.query(`INSERT INTO cobranca_saas (grupo_id, assinatura_id, competencia, vencimento, empresas_cobradas, valor_bruto_centavos, valor_centavos)
                       VALUES ($1,$2,'2026-01-01','2026-01-10',1,1000,1000)`, [cen.A.grupoId, a]);
        return a;
      });
      for (const t of ['assinatura_saas', 'cobranca_saas']) {
        expect((await db.tenant(rede(cen.B.grupoId), (c) => c.query(`SELECT 1 FROM ${t}`))).rowCount, t).toBe(0);
        expect((await db.semTenant((c) => c.query(`SELECT 1 FROM ${t}`))).rowCount, t).toBe(0);
        await expect(db.tenant(rede(cen.A.grupoId), (c) => c.query(`DELETE FROM ${t}`)), t).rejects.toMatchObject({ code: '42501' });
      }
      expect((await db.tenant(rede(cen.B.grupoId), (c) => c.query(`UPDATE cobranca_saas SET status = 'PAGA', pago_em = now(), forma_pagamento = 'PIX'`))).rowCount).toBe(0);
      await expect(db.tenant(rede(cen.B.grupoId), (c) => c.query(
        `INSERT INTO assinatura_saas (grupo_id, plano_id, valor_base_centavos, empresas_incluidas, valor_empresa_adicional_centavos, dia_vencimento, inicio)
         VALUES ($1,$2,1,1,0,5,'2026-01-01')`, [cen.A.grupoId, plano]))).rejects.toMatchObject({ code: '42501' });
      // mensalidade do grupo B apontando para a assinatura do A: a chave composta (id, grupo_id) recusa
      await expect(db.tenant(rede(cen.B.grupoId), (c) => c.query(
        `INSERT INTO cobranca_saas (grupo_id, assinatura_id, competencia, vencimento, empresas_cobradas, valor_bruto_centavos, valor_centavos)
         VALUES ($1,$2,'2026-02-01','2026-02-10',1,1,1)`, [cen.B.grupoId, ass]))).rejects.toMatchObject({ code: '23503' });
    });
  });
});
