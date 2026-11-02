import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 51000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('comissões do vistoriador', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C;
  let servico: string, cli: string, pix: string, ana: string, joao: string, banco: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const lancar = async (vistoriadorId: string, extra: object = {}) => {
    const r = await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: pix, vistoriadorId, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body as { id: string };
  };
  const apur = async (vistoriadorId?: string) => ((await ger.get(`/comissoes/apuracao?de=${hoje()}&ate=${hoje()}${vistoriadorId ? `&vistoriadorId=${vistoriadorId}` : ''}`)).body as { vistoriadorId: string; laudos: number; totalCentavos: number; aguardandoCentavos: number }[]);
  const regra = async (c: C, corpo: object) => c.post('/comissoes/regras', { vigenciaIni: '2025-01-01', ...corpo });
  const limparRegras = async () => { for (const r of (await ger.get('/comissoes/regras')).body as { id: string; ativa: boolean }[]) if (r.ativa) await ger.patch(`/comissoes/regras/${r.id}`, { ativa: false }); };

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2'].map(entrar))) as [C, C, C, C, C];
    servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}` })).body.id;
    await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    pix = formas.find((f) => f.nome === 'PIX')!.id;
    ana = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()], usuarioId: cen.A.usuarioIds[3] })).body.id;
    joao = (await adm.post('/vistoriadores', { nome: 'João', empresaIds: [A1()] })).body.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  });
  afterAll(() => app.close());

  describe('regras', () => {
    it('Gerente e Administrativo criam; Financeiro só vê; Vistoriador, nada', async () => {
      expect((await regra(fin, { tipo: 'PERCENTUAL', percentualBp: 1000 })).status).toBe(403);
      expect((await fin.get('/comissoes/regras')).status).toBe(200);
      expect((await vis.get('/comissoes/regras')).status).toBe(403);
      expect((await regra(ger, { tipo: 'PERCENTUAL' })).status).toBe(422);
      expect((await regra(ger, { tipo: 'VALOR', valorCentavos: 0 })).status).toBe(422);
      expect((await regra(ger, { tipo: 'PERCENTUAL', percentualBp: 1000, vigenciaFim: '2024-01-01' })).status).toBe(422);
      expect((await regra(ger, { tipo: 'PERCENTUAL', percentualBp: 1000, vistoriadorId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    });
  });

  describe('cálculo e snapshot no laudo', () => {
    it('percentual sobre o valor cobrado; desconto reduz a comissão', async () => {
      expect((await regra(ger, { tipo: 'PERCENTUAL', percentualBp: 1000 })).status).toBe(201);
      await lancar(joao); await lancar(joao, { valorCobradoCentavos: 15000, ajusteMotivo: 'Acordo comercial' });
      expect((await apur(joao))[0]!).toMatchObject({ laudos: 2, totalCentavos: 1800 + 1500 });
    });
    it('a regra mais específica vence: vistoriador com valor fixo', async () => {
      expect((await regra(ger, { tipo: 'VALOR', valorCentavos: 500, vistoriadorId: ana })).status).toBe(201);
      await lancar(ana); await lancar(joao);
      expect((await apur(ana))[0]!).toMatchObject({ laudos: 1, totalCentavos: 500 });
      expect((await apur(joao))[0]!).toMatchObject({ laudos: 3, totalCentavos: 1800 + 1500 + 1800 });
    });
    it('mudar a regra depois não reescreve o laudo já lançado', async () => {
      await limparRegras();
      expect((await regra(ger, { tipo: 'PERCENTUAL', percentualBp: 2000 })).status).toBe(201);
      await lancar(joao);
      expect((await apur(joao))[0]!.totalCentavos).toBe(1800 + 1500 + 1800 + 3600);
    });
    it('editar o valor do laudo recalcula a comissão', async () => {
      const l = await lancar(joao);
      const antes = (await apur(joao))[0]!.totalCentavos;
      expect((await ger.patch(`/laudos/${l.id}`, { valorCobradoCentavos: 10000, ajusteMotivo: 'Desconto de balcão' })).status).toBe(200);
      expect((await apur(joao))[0]!.totalCentavos).toBe(antes - 3600 + 2000);
    });
    it('laudo cancelado perde a comissão', async () => {
      const l = await lancar(joao);
      const antes = (await apur(joao))[0]!.totalCentavos;
      await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Lançado em duplicidade' });
      expect((await apur(joao))[0]!.totalCentavos).toBe(antes - 3600);
    });
  });

  describe('devida no recebimento', () => {
    it('só entra no fechamento depois que o cliente paga o laudo', async () => {
      await limparRegras();
      const carlos = (await adm.post('/vistoriadores', { nome: 'Carlos', empresaIds: [A1()] })).body.id;
      await regra(ger, { tipo: 'PERCENTUAL', percentualBp: 1000, devidaEm: 'RECEBIMENTO', vistoriadorId: carlos });
      const l = await lancar(carlos);
      let g = (await apur(carlos)).find((x) => x.vistoriadorId === carlos)!;
      expect(g).toMatchObject({ totalCentavos: 0, aguardandoCentavos: 1800 });
      const t = ((await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[]).find((x) => x.laudoId === l.id)!;
      await ger.post(`/receber/titulos/${t.id}/baixas`, { contaId: banco });
      g = (await apur(carlos)).find((x) => x.vistoriadorId === carlos)!;
      expect(g).toMatchObject({ laudos: 1, totalCentavos: 1800, aguardandoCentavos: 0 });
    });
  });

  describe('fechamento', () => {
    let fechId: string, tituloId: string, laudoFechado: string;
    beforeAll(async () => { await limparRegras(); await regra(ger, { tipo: 'VALOR', valorCentavos: 700 }); });
    it('gera uma conta a pagar por vistoriador, uma única vez', async () => {
      laudoFechado = (await lancar(ana)).id; await lancar(ana); await lancar(joao);
      expect((await fin.post('/comissoes/fechar', { de: hoje(), ate: hoje() })).status).toBe(403);
      const r = await ger.post('/comissoes/fechar', { de: hoje(), ate: hoje() });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const da = r.body.criados.find((x: { vistoriador: string }) => x.vistoriador === 'Ana');
      expect(da.totalCentavos).toBeGreaterThanOrEqual(1400); fechId = da.id; tituloId = da.tituloId;
      const t = (await ger.get(`/pagar/titulos/${tituloId}`)).body;
      expect(t).toMatchObject({ origem: 'COMISSAO', favorecido: 'Ana', status: 'PENDENTE' });
      expect((await ger.post('/comissoes/fechar', { de: hoje(), ate: hoje() })).body.fechamentos).toBe(0);
      expect((await apur(ana)).find((x) => x.vistoriadorId === ana)?.totalCentavos ?? 0).toBe(0);
    });
    it('laudo com comissão fechada não muda nem cancela até desfazer o fechamento', async () => {
      expect((await ger.patch(`/laudos/${laudoFechado}`, { observacao: 'mexendo' })).status).toBe(409);
      expect((await ger.post(`/laudos/${laudoFechado}/cancelar`, { motivo: 'Quero cancelar' })).status).toBe(409);
    });
    it('não cancela o fechamento se a conta já foi paga; senão cancela a conta e libera as comissões', async () => {
      await adm.post(`/pagar/titulos/${tituloId}/aprovar`);
      await adm.post(`/pagar/titulos/${tituloId}/pagamentos`, { contaId: banco, principalCentavos: 100 });
      expect((await ger.post(`/comissoes/fechamentos/${fechId}/cancelar`, { motivo: 'Refazer o período' })).status).toBe(409);
      const outro = (await ger.post('/comissoes/fechar', { de: hoje(), ate: hoje() })).body;
      const lista = (await ger.get('/comissoes/fechamentos')).body as { id: string; vistoriador: string; status: string }[];
      expect(lista.find((f) => f.id === fechId)).toMatchObject({ status: 'FECHADO', vistoriador: 'Ana' });
      void outro;
      const j = lista.find((f) => f.vistoriador === 'João')!;
      expect((await ger.post(`/comissoes/fechamentos/${j.id}/cancelar`, { motivo: 'Refazer o período' })).status).toBe(201);
      expect((await apur(joao))[0]!.totalCentavos).toBeGreaterThan(0);
      expect((await ger.post(`/comissoes/fechamentos/${j.id}/cancelar`, { motivo: 'De novo' })).status).toBe(409);
    });
    it('vistoriador desta loja só aparece para ela; outra loja e outro grupo não enxergam nada', async () => {
      expect((await gerA2.get('/comissoes/fechamentos')).body).toEqual([]);
      const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, t: string) => (await db.tenant(ctx, (c) => c.query(`SELECT 1 FROM ${t}`))).rowCount;
      for (const t of ['regra_comissao', 'laudo_comissao', 'fechamento_comissao']) {
        expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, t), t).toBeGreaterThan(0);
        expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, t), t).toBe(0);
        expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] }, t), t).toBe(0);
      }
    });
    it('as ações ficam no log', async () => {
      const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
      expect(acoes).toEqual(expect.arrayContaining(['comissao.regra_criada', 'comissao.regra_alterada', 'comissao.fechada', 'comissao.fechamento_cancelado']));
    });
  });
});
