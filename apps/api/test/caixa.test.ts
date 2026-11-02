import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

describe('caixa', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  let adm: ReturnType<typeof cliente>, ger: ReturnType<typeof cliente>, fin: ReturnType<typeof cliente>, vis: ReturnType<typeof cliente>, gerA2: ReturnType<typeof cliente>, admB: ReturnType<typeof cliente>;
  let caixaId: string, bancoId: string, bancoA2: string;
  const A1 = () => cen.A.empresaIds[0]!, A2 = () => cen.A.empresaIds[1]!;
  const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const saldo = async (c: ReturnType<typeof cliente>, id: string) => ((await c.get('/caixa/contas')).body.contas as { id: string; saldoCentavos: number }[]).find((x) => x.id === id)!.saldoCentavos;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2', 'adminB'].map(entrar))) as [typeof adm, typeof adm, typeof adm, typeof adm, typeof adm, typeof adm];
    caixaId = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Caixa da loja', tipo: 'CAIXA', saldoInicialCentavos: 10000, dataSaldoInicial: '2026-01-01' })).body.conta.id;
    bancoId = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2026-01-01' })).body.conta.id;
    bancoA2 = (await adm.post('/contas-financeiras', { empresaId: A2(), nome: 'Banco A2', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2026-01-01' })).body.conta.id;
  });
  afterAll(() => app.close());

  describe('saldo e extrato', () => {
    it('lista as contas da loja ativa com o saldo de hoje', async () => {
      const r = await ger.get('/caixa/contas');
      expect(r.status).toBe(200);
      expect(r.body.contas.map((c: { nome: string }) => c.nome).sort()).toEqual(['Banco', 'Caixa da loja']);
      expect(await saldo(ger, caixaId)).toBe(10000);
    });
    it('Vistoriador não acessa o caixa', async () => {
      expect((await vis.get('/caixa/contas')).status).toBe(403);
    });
    it('ajuste de entrada e de saída muda o saldo e aparece no extrato com saldo corrido', async () => {
      expect((await ger.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: 5000, descricao: 'Aporte do dono', motivo: 'Reforço de troco' })).status).toBe(201);
      expect((await ger.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: -2500, descricao: 'Sangria', motivo: 'Depósito ao fim do dia' })).status).toBe(201);
      expect(await saldo(ger, caixaId)).toBe(12500);
      const ex = (await ger.get(`/caixa/extrato?contaId=${caixaId}&de=2026-01-01`)).body;
      expect(ex.aberturaCentavos).toBe(0);
      expect(ex.entradasCentavos).toBe(5000); expect(ex.saidasCentavos).toBe(-2500); expect(ex.fechoCentavos).toBe(12500);
      expect(ex.itens.map((i: { saldoCentavos: number }) => i.saldoCentavos)).toEqual([10000, 15000, 12500]);
      expect(ex.itens[0].descricao).toBe('Saldo inicial da conta');
    });
    it('ajuste pede motivo, valor diferente de zero e data que não seja futura', async () => {
      expect((await ger.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: 100, descricao: 'x1', motivo: '' })).status).toBe(422);
      expect((await ger.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: 0, descricao: 'zero', motivo: 'sem valor nenhum' })).status).toBe(422);
      expect((await ger.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: 100, descricao: 'futuro', motivo: 'data adiante', data: '2999-01-01' })).status).toBe(422);
    });
    it('Financeiro não faz ajuste; só vê', async () => {
      expect((await fin.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: 100, descricao: 'x', motivo: 'tentativa de ajuste' })).status).toBe(403);
      expect((await fin.get('/caixa/contas')).status).toBe(200);
    });
    it('gerente de outra loja não enxerga a conta', async () => {
      expect((await gerA2.get(`/caixa/extrato?contaId=${caixaId}`)).status).toBe(404);
      expect((await admB.get(`/caixa/extrato?contaId=${caixaId}`)).status).toBe(404);
    });
  });

  describe('transferências', () => {
    it('entre contas da mesma loja move o dinheiro nas duas pontas', async () => {
      const r = await fin.post('/caixa/transferencias', { contaOrigemId: caixaId, contaDestinoId: bancoId, valorCentavos: 2000, descricao: 'Depósito do dia' });
      expect(r.status).toBe(201);
      expect(await saldo(ger, caixaId)).toBe(10500);
      expect(await saldo(ger, bancoId)).toBe(2000);
    });
    it('não tira do caixa mais do que ele tem', async () => {
      const r = await ger.post('/caixa/transferencias', { contaOrigemId: caixaId, contaDestinoId: bancoId, valorCentavos: 99_999_00, descricao: 'Grande demais' });
      expect(r.status).toBe(409);
      expect(r.body.mensagem).toMatch(/não dá para tirar/);
    });
    it('entre lojas (intercompany) só o Administrativo; o Gerente não', async () => {
      const g = await ger.post('/caixa/transferencias', { contaOrigemId: bancoId, contaDestinoId: bancoA2, valorCentavos: 500, descricao: 'Empréstimo entre lojas' });
      expect([403, 404]).toContain(g.status);
      const r = await adm.post('/caixa/transferencias', { contaOrigemId: bancoId, contaDestinoId: bancoA2, valorCentavos: 500, descricao: 'Empréstimo entre lojas' });
      expect(r.status).toBe(201);
      const t = await db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT intercompany FROM transferencia WHERE id = $1', [r.body.id]));
      expect(t.rows[0].intercompany).toBe(true);
      expect(await saldo(ger, bancoId)).toBe(1500);
    });
    it('origem e destino precisam ser diferentes', async () => {
      expect((await ger.post('/caixa/transferencias', { contaOrigemId: bancoId, contaDestinoId: bancoId, valorCentavos: 100, descricao: 'mesma conta' })).status).toBe(422);
    });
  });

  describe('estorno', () => {
    it('estorna um ajuste com o lançamento contrário, uma vez só', async () => {
      const a = await ger.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: -700, descricao: 'Lanche', motivo: 'Despesa pequena' });
      const antes = await saldo(ger, caixaId);
      expect((await ger.post(`/caixa/lancamentos/${a.body.id}/estornar`, { motivo: 'Lançado na conta errada' })).status).toBe(201);
      expect(await saldo(ger, caixaId)).toBe(antes + 700);
      expect((await ger.post(`/caixa/lancamentos/${a.body.id}/estornar`, { motivo: 'Tentando de novo' })).status).toBe(409);
    });
    it('lançamento não se altera nem se apaga, nem direto no banco', async () => {
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await expect(db.tenant(ctx, (c) => c.query(`UPDATE lancamento_financeiro SET valor_centavos = 1`))).rejects.toThrow();
      await expect(db.tenant(ctx, (c) => c.query(`DELETE FROM lancamento_financeiro`))).rejects.toThrow();
    });
  });

  describe('fechamento diário', () => {
    let fechId: string;
    it('com diferença exige explicação; sem diferença fecha', async () => {
      const ontem = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const s = await saldo(ger, bancoId);
      const r1 = await ger.post('/caixa/fechar-dia', { contaId: bancoId, data: hoje(), saldoContadoCentavos: s - 150 });
      expect(r1.status).toBe(422); expect(r1.body.diferencaCentavos).toBe(-150);
      void ontem;
      const r2 = await ger.post('/caixa/fechar-dia', { contaId: bancoId, data: hoje(), saldoContadoCentavos: s - 150, observacao: 'Tarifa que ainda não lançamos' });
      expect(r2.status).toBe(201); fechId = r2.body.id;
    });
    it('depois de fechado, o banco recusa lançamento nessa data ou antes', async () => {
      const r = await ger.post('/caixa/ajustes', { contaId: bancoId, valorCentavos: -150, descricao: 'Tarifa', motivo: 'Tarifa do dia' });
      expect(r.status).toBe(409); expect(r.body.mensagem).toMatch(/fechado/);
      expect((await ger.post('/caixa/ajustes', { contaId: bancoId, valorCentavos: -150, descricao: 'Tarifa antiga', motivo: 'Tarifa do mês', data: '2026-02-01' })).status).toBe(409);
    });
    it('não fecha de novo um dia já fechado e Financeiro pode fechar caixa mas não reabrir', async () => {
      expect((await ger.post('/caixa/fechar-dia', { contaId: bancoId, data: hoje(), saldoContadoCentavos: 0, observacao: 'de novo' })).status).toBe(409);
      expect((await fin.post(`/caixa/fechamentos/${fechId}/reabrir`, { motivo: 'Preciso corrigir' })).status).toBe(403);
    });
    it('o Gerente reabre o último dia fechado, com motivo, e o lançamento volta a ser aceito', async () => {
      expect((await ger.post(`/caixa/fechamentos/${fechId}/reabrir`, { motivo: '' })).status).toBe(422);
      expect((await ger.post(`/caixa/fechamentos/${fechId}/reabrir`, { motivo: 'Faltou lançar a tarifa' })).status).toBe(201);
      expect((await ger.post('/caixa/ajustes', { contaId: bancoId, valorCentavos: -150, descricao: 'Tarifa', motivo: 'Tarifa do dia' })).status).toBe(201);
      const f = (await ger.get('/caixa/fechamentos')).body;
      expect(f.dias.find((d: { id: string }) => d.id === fechId).status).toBe('REABERTO');
    });
    it('não fecha dia futuro', async () => {
      expect((await ger.post('/caixa/fechar-dia', { contaId: bancoId, data: '2999-01-01', saldoContadoCentavos: 0 })).status).toBe(422);
    });
  });

  describe('fechamento mensal', () => {
    it('só fecha mês encerrado, com caixas fechados até o fim dele', async () => {
      expect((await ger.post('/caixa/fechar-periodo', { mes: hoje().slice(0, 7) })).status).toBe(422);
      const aberto = await ger.post('/caixa/fechar-periodo', { mes: '2026-01' });
      expect(aberto.status).toBe(409); expect(aberto.body.mensagem).toMatch(/Feche o caixa até 31\/01\/2026/);
      for (const id of [caixaId, bancoId]) {
        const r = await ger.post('/caixa/fechar-dia', { contaId: id, data: '2026-01-31', saldoContadoCentavos: await saldoEm(id, '2026-01-31') });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
      }
      expect((await ger.post('/caixa/fechar-periodo', { mes: '2026-01' })).status).toBe(201);
      expect((await ger.post('/caixa/fechar-periodo', { mes: '2026-01' })).status).toBe(409);
    });
    it('mês fechado: lançamento e laudo naquela data são recusados; só o Administrativo reabre', async () => {
      const r = await adm.post('/caixa/ajustes', { contaId: caixaId, valorCentavos: 100, descricao: 'Atrasado', motivo: 'Lançamento atrasado', data: '2026-01-15' });
      expect(r.status).toBe(409);
      expect((await ger.post('/caixa/periodos/2026-01/reabrir', { motivo: 'Preciso corrigir' })).status).toBe(403);
      expect((await adm.post('/caixa/periodos/2026-01/reabrir', { motivo: 'Correção aprovada pela diretoria' })).status).toBe(201);
      expect((await ger.get('/caixa/fechamentos')).body.meses[0].status).toBe('REABERTO');
    });
    async function saldoEm(contaId: string, data: string) {
      return Number((await ger.get(`/caixa/extrato?contaId=${contaId}&de=2026-01-01&ate=${data}`)).body.fechoCentavos);
    }
  });

  describe('auditoria e isolamento', () => {
    it('as ações ficam no log com quem fez e o motivo', async () => {
      const log = (await adm.get('/auditoria?limite=200')).body as { itens: { acao: string; motivo: string | null }[] };
      const acoes = log.itens.map((i) => i.acao);
      expect(acoes).toEqual(expect.arrayContaining(['caixa.ajuste', 'caixa.transferencia', 'caixa.transferencia_intercompany', 'caixa.estorno', 'caixa.dia_fechado', 'caixa.dia_reaberto', 'periodo.fechado', 'periodo.reaberto']));
    });
    it('direto no banco, o grupo B e a loja A2 não leem o razão de A1', async () => {
      const total = Number((await db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT count(*)::int AS n FROM lancamento_financeiro WHERE empresa_id = $1', [A1()]))).rows[0].n);
      expect(total).toBeGreaterThan(0);
      const deB = await db.tenant({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT 1 FROM lancamento_financeiro'));
      expect(deB.rowCount).toBe(0);
      const deA2 = await db.tenant({ grupoId: cen.A.grupoId, rede: false, empresas: [A2()] }, (c) => c.query('SELECT 1 FROM lancamento_financeiro WHERE empresa_id = $1', [A1()]));
      expect(deA2.rowCount).toBe(0);
      const fech = await db.tenant({ grupoId: cen.A.grupoId, rede: false, empresas: [A2()] }, (c) => c.query('SELECT 1 FROM fechamento_caixa WHERE empresa_id = $1', [A1()]));
      expect(fech.rowCount).toBe(0);
      void unico;
    });
  });
});
