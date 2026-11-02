import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 5000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('contas a receber', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C, admB: C;
  let servicoId: string, clienteId: string, faturado: string, pix: string, vist: string, caixa: string, banco: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const lancar = async (extra: object = {}) => {
    const r = await ger.post('/laudos', { placa: placa(), clienteId, servicoId, formaPagamentoId: faturado, vistoriadorId: vist, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; numero: number };
  };
  const titulos = async (c: C, q = 'situacao=todos') => (await c.get(`/receber/titulos?${q}&limite=500`)).body.itens as { id: string; laudoId: string; numero: number; valorCentavos: number; pagoCentavos: number; saldoCentavos: number; vencimento: string; status: string; vencido: boolean }[];
  const tituloDe = async (laudoId: string) => (await titulos(ger)).find((t) => t.laudoId === laudoId)!;
  const saldoConta = async (id: string) => ((await ger.get('/caixa/contas')).body.contas as { id: string; saldoCentavos: number }[]).find((c) => c.id === id)!.saldoCentavos;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2', 'adminB'].map(entrar))) as [C, C, C, C, C, C];
    servicoId = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    clienteId = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Auto Center ${unico()}` })).body.id;
    await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    faturado = formas.find((f) => f.nome === 'Faturado')!.id; pix = formas.find((f) => f.nome === 'PIX')!.id;
    vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()], usuarioId: cen.A.usuarioIds[3] })).body.id;
    caixa = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Caixa', tipo: 'CAIXA', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  });
  afterAll(() => app.close());

  describe('título do laudo', () => {
    it('nasce com o laudo: faturado vence em data + prazo do cliente, à vista vence no dia', async () => {
      const f = await lancar(); const p = await lancar({ formaPagamentoId: pix });
      const tf = await tituloDe(f.id); const tp = await tituloDe(p.id);
      expect(tf).toMatchObject({ valorCentavos: 18000, pagoCentavos: 0, status: 'ABERTO' });
      expect(tf.vencimento).toBe(new Date(Date.parse(hoje()) + 10 * 86_400_000).toISOString().slice(0, 10));
      expect(tp.vencimento).toBe(hoje());
    });
    it('laudo de valor zero (cortesia) não gera título', async () => {
      const l = await lancar({ valorCobradoCentavos: 0, ajusteMotivo: 'Cortesia da casa' });
      expect((await titulos(ger)).find((t) => t.laudoId === l.id)).toBeUndefined();
    });
    it('editar o valor do laudo atualiza o título; cancelar o laudo cancela o título', async () => {
      const l = await lancar();
      expect((await ger.patch(`/laudos/${l.id}`, { valorCobradoCentavos: 15000, ajusteMotivo: 'Acordo comercial' })).status).toBe(200);
      expect(await tituloDe(l.id)).toMatchObject({ valorCentavos: 15000, status: 'ABERTO' });
      expect((await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Lançado em duplicidade' })).status).toBe(201);
      expect(await tituloDe(l.id)).toMatchObject({ status: 'CANCELADO' });
      expect((await ger.post(`/receber/titulos/${(await tituloDe(l.id)).id}/baixas`, { contaId: caixa })).status).toBe(409);
    });
  });

  describe('baixa', () => {
    it('total, em dia: quita, entra no caixa e trava o laudo', async () => {
      const l = await lancar({ formaPagamentoId: pix }); const t = await tituloDe(l.id);
      const antes = await saldoConta(caixa);
      const r = await fin.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ principalCentavos: 18000, multaCentavos: 0, jurosCentavos: 0, recebidoCentavos: 18000, tituloStatus: 'QUITADO' });
      expect(await saldoConta(caixa)).toBe(antes + 18000);
      expect((await ger.get(`/laudos/${l.id}`)).body.travado).toBe(true);
      expect((await ger.patch(`/laudos/${l.id}`, { valorCobradoCentavos: 100, ajusteMotivo: 'Tentativa' })).status).toBe(409);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa })).status).toBe(409);
    });
    it('parcial: fica PARCIAL com o saldo; a segunda baixa quita; não passa do saldo', async () => {
      const l = await lancar({ formaPagamentoId: pix }); const t = await tituloDe(l.id);
      const r1 = await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: banco, principalCentavos: 10000 });
      expect(r1.body.tituloStatus).toBe('PARCIAL');
      expect(await tituloDe(l.id)).toMatchObject({ pagoCentavos: 10000, saldoCentavos: 8000, status: 'PARCIAL' });
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: banco, principalCentavos: 8001 })).status).toBe(422);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: banco, principalCentavos: 8000 })).body.tituloStatus).toBe('QUITADO');
    });
    it('atrasado: cobra multa de 2% e juros de 1% ao mês pro rata (20 dias) sobre o que está pagando', async () => {
      const l = await lancar({ dataLaudo: diasAtras(30) }); const t = await tituloDe(l.id);
      expect(t.vencido).toBe(true);
      const sim = (await ger.get(`/receber/titulos/${t.id}/simular`)).body;
      expect(sim).toMatchObject({ diasAtraso: 20, multaCentavos: 360, jurosCentavos: 120, totalCentavos: 18480 });
      const antes = await saldoConta(banco);
      const r = await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: banco });
      expect(r.body).toMatchObject({ principalCentavos: 18000, multaCentavos: 360, jurosCentavos: 120, recebidoCentavos: 18480 });
      expect(await saldoConta(banco)).toBe(antes + 18480);
    });
    it('parcial em atraso: encargos só sobre a parte paga', async () => {
      const l = await lancar({ dataLaudo: diasAtras(30) }); const t = await tituloDe(l.id);
      const r = await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: banco, principalCentavos: 9000 });
      expect(r.body).toMatchObject({ multaCentavos: 180, jurosCentavos: 60, recebidoCentavos: 9240 });
    });
    it('perdão de encargos: Financeiro até o limite, com motivo; acima do limite só o Gerente', async () => {
      const l = await lancar({ dataLaudo: diasAtras(30) }); const t = await tituloDe(l.id);
      expect((await fin.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa, perdoarEncargos: true })).status).toBe(422); // sem motivo
      const ok = await fin.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa, perdoarEncargos: true, motivo: 'Cliente antigo, acordo' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body).toMatchObject({ perdaoCentavos: 480, recebidoCentavos: 18000 });
      // limite de R$ 1,00 para o Financeiro: o perdão de R$ 4,80 passa a exigir Gerente
      expect((await adm.put('/receber/config', { perdaoLimiteCentavos: 100 })).status).toBe(200);
      const l2 = await lancar({ dataLaudo: diasAtras(30) }); const t2 = await tituloDe(l2.id);
      const bloq = await fin.post(`/receber/titulos/${t2.id}/baixas`, { contaId: caixa, perdoarEncargos: true, motivo: 'Cliente antigo, acordo' });
      expect(bloq.status).toBe(403); expect(bloq.body.mensagem).toMatch(/perdoa até R\$ 1,00/);
      expect((await ger.post(`/receber/titulos/${t2.id}/baixas`, { contaId: caixa, perdoarEncargos: true, motivo: 'Autorizado pela gerência' })).status).toBe(201);
      expect((await adm.put('/receber/config', { perdaoLimiteCentavos: 5000 })).status).toBe(200);
    });
    it('o perdão não passa dos encargos; só o Administrativo muda a configuração', async () => {
      const l = await lancar({ dataLaudo: diasAtras(30) }); const t = await tituloDe(l.id);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa, perdaoCentavos: 99999, motivo: 'Perdão exagerado' })).status).toBe(422);
      expect((await ger.put('/receber/config', { perdaoLimiteCentavos: 1 })).status).toBe(403);
    });
    it('exige conta, data válida e forma ativa', async () => {
      const l = await lancar({ formaPagamentoId: pix }); const t = await tituloDe(l.id);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, {})).status).toBe(422);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa, data: '2999-01-01' })).status).toBe(422);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa, data: diasAtras(400) })).status).toBe(422);
    });
    it('Vistoriador não baixa; a conta de outra loja é recusada', async () => {
      const l = await lancar({ formaPagamentoId: pix }); const t = await tituloDe(l.id);
      expect((await vis.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa })).status).toBe(403);
      const outra = (await adm.post('/contas-financeiras', { empresaId: cen.A.empresaIds[1], nome: 'Caixa A2', tipo: 'CAIXA', saldoInicialCentavos: 0 })).body.conta.id;
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: outra })).status).toBe(404);
    });
  });

  describe('estorno', () => {
    it('o Gerente estorna: o título reabre, o caixa volta e o laudo destrava; não estorna duas vezes', async () => {
      const l = await lancar({ formaPagamentoId: pix }); const t = await tituloDe(l.id);
      const b = (await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa })).body;
      const antes = await saldoConta(caixa);
      expect((await ger.post(`/receber/baixas/${b.id}/estornar`, { motivo: '' })).status).toBe(422);
      const e = await ger.post(`/receber/baixas/${b.id}/estornar`, { motivo: 'PIX não caiu na conta' });
      expect(e.status, JSON.stringify(e.body)).toBe(201); expect(e.body.tituloStatus).toBe('ABERTO');
      expect(await saldoConta(caixa)).toBe(antes - 18000);
      expect(await tituloDe(l.id)).toMatchObject({ status: 'ABERTO', pagoCentavos: 0 });
      expect((await ger.get(`/laudos/${l.id}`)).body.travado).toBe(false);
      expect((await ger.post(`/receber/baixas/${b.id}/estornar`, { motivo: 'Tentando de novo' })).status).toBe(409);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa })).status).toBe(201); // pode receber de novo
    });
    it('o Financeiro estorna em período aberto, mas não o Vistoriador', async () => {
      const l = await lancar({ formaPagamentoId: pix }); const t = await tituloDe(l.id);
      const b = (await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa })).body;
      expect((await vis.post(`/receber/baixas/${b.id}/estornar`, { motivo: 'Tentativa indevida' })).status).toBe(403);
      expect((await fin.post(`/receber/baixas/${b.id}/estornar`, { motivo: 'Valor lançado errado' })).status).toBe(201);
    });
    it('o estorno é um registro novo e a baixa original nunca muda (nem direto no banco)', async () => {
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await expect(db.tenant(ctx, (c) => c.query(`UPDATE baixa_receber SET principal_centavos = 1`))).rejects.toThrow();
      await expect(db.tenant(ctx, (c) => c.query(`DELETE FROM baixa_receber`))).rejects.toThrow();
    });
  });

  describe('lote e listagem', () => {
    it('baixa em lote: as boas entram, as com problema voltam com o motivo', async () => {
      const a = await tituloDe((await lancar({ formaPagamentoId: pix })).id); const b = await tituloDe((await lancar({ formaPagamentoId: pix })).id); const q = await tituloDe((await lancar({ formaPagamentoId: pix })).id);
      await ger.post(`/receber/titulos/${q.id}/baixas`, { contaId: caixa });
      const r = await fin.post('/receber/baixas-lote', { itens: [{ tituloId: a.id }, { tituloId: q.id }, { tituloId: b.id }], contaId: caixa });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ baixados: 2, erros: 1 });
      expect(r.body.resultados[1]).toMatchObject({ ok: false, erro: 'Este título já está quitado.' });
      expect((await tituloDe((await ger.get(`/laudos?limite=1`)).body.itens[0].id)).status).toBeDefined();
    });
    it('filtra por situação e mostra o resumo da loja', async () => {
      const venc = await titulos(ger, 'situacao=vencidos');
      expect(venc.length).toBeGreaterThan(0); expect(venc.every((t) => t.vencido && t.saldoCentavos > 0)).toBe(true);
      const quit = await titulos(ger, 'situacao=quitados'); expect(quit.every((t) => t.status === 'QUITADO')).toBe(true);
      const r = (await ger.get('/receber/resumo')).body;
      expect(r.aReceberCentavos).toBeGreaterThan(0); expect(r.vencidoCentavos).toBeGreaterThan(0); expect(r.recebidoNoMesCentavos).toBeGreaterThan(0);
    });
    it('o Vistoriador não vê o contas a receber; o Gerente de outra loja não enxerga os títulos', async () => {
      expect((await vis.get('/receber/titulos')).status).toBe(403);
      const t = (await titulos(ger))[0]!;
      expect((await gerA2.get(`/receber/titulos/${t.id}`)).status).toBe(404);
      expect((await admB.get(`/receber/titulos/${t.id}`)).status).toBe(404);
    });
  });

  describe('período fechado e isolamento', () => {
    it('baixa com data em mês fechado é recusada', async () => {
      const l = await lancar({ dataLaudo: diasAtras(60) }); const t = await tituloDe(l.id);
      const mesPassado = diasAtras(60).slice(0, 7);
      // fecha o caixa das contas até o fim do mês do laudo e depois o mês
      const fim = new Date(Date.UTC(+mesPassado.slice(0, 4), +mesPassado.slice(5, 7), 0)).toISOString().slice(0, 10);
      if (fim >= hoje()) return;
      for (const id of [caixa, banco]) {
        const ex = (await ger.get(`/caixa/extrato?contaId=${id}&de=2025-01-01&ate=${fim}`)).body;
        expect((await ger.post('/caixa/fechar-dia', { contaId: id, data: fim, saldoContadoCentavos: ex.fechoCentavos })).status).toBe(201);
      }
      expect((await ger.post('/caixa/fechar-periodo', { mes: mesPassado })).status).toBe(201);
      const r = await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: caixa, data: fim });
      expect(r.status).toBe(409);
      expect((await ger.patch(`/laudos/${l.id}`, { valorCobradoCentavos: 100, ajusteMotivo: 'Tentativa em mês fechado' })).status).toBe(409);
    });
    it('direto no banco, outro grupo ou outra loja não lê títulos nem baixas', async () => {
      const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, tabela: string) => (await db.tenant(ctx, (c) => c.query(`SELECT 1 FROM ${tabela} WHERE empresa_id = $1`, [A1()]))).rowCount;
      expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, 'titulo_receber')).toBeGreaterThan(0);
      expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, 'baixa_receber')).toBeGreaterThan(0);
      for (const t of ['titulo_receber', 'baixa_receber', 'empresa_config']) {
        expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, t), t).toBe(0);
        expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] }, t), t).toBe(0);
      }
    });
    it('as ações ficam no log', async () => {
      const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
      expect(acoes).toEqual(expect.arrayContaining(['receber.baixa', 'receber.baixa_estornada', 'config_financeira.alterada']));
    });
  });
});
