import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diasAtras = (n: number) => new Date(Date.parse(hoje()) - n * 86_400_000).toISOString().slice(0, 10);
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 31000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('relatórios, painel e LGPD', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C, admB: C;
  let servico: string, cli: string, cliPf: string, pix: string, faturado: string, vist: string, banco: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const lancar = async (clienteId: string, extra: object = {}) => {
    const r = await ger.post('/laudos', { placa: placa(), clienteId, servicoId: servico, formaPagamentoId: pix, vistoriadorId: vist, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body as { id: string };
  };
  const rel = async (c: C, id: string, q = '') => c.get(`/relatorios/${id}?${q}`);

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2', 'adminB'].map(entrar))) as [C, C, C, C, C, C];
    servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    await adm.post(`/servicos/${servico}/custos`, { descricao: 'Taxa', tipo: 'VALOR', valorCentavos: 4000 });
    cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Auto Center ${unico()}` })).body.id;
    cliPf = (await adm.post('/clientes', { tipoPessoa: 'PF', nome: `Maria da Silva ${unico()}`, documento: '52998224725', telefone: '11999998888' })).body.id;
    for (const id of [cli, cliPf]) await adm.post(`/clientes/${id}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    pix = formas.find((f) => f.nome === 'PIX')!.id; faturado = formas.find((f) => f.nome === 'Faturado')!.id;
    vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()], usuarioId: cen.A.usuarioIds[3] })).body.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    // movimento: 3 laudos do cliente PJ (um com desconto, dois pagos) e 1 do PF; um faturado vencido
    const l1 = await lancar(cli); const l2 = await lancar(cli); await lancar(cli, { valorCobradoCentavos: 15000, ajusteMotivo: 'Acordo comercial' }); await lancar(cliPf);
    const velho = await lancar(cli, { formaPagamentoId: faturado, dataLaudo: diasAtras(50) });
    const titulos = (await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[];
    for (const l of [l1, l2]) await ger.post(`/receber/titulos/${titulos.find((t) => t.laudoId === l.id)!.id}/baixas`, { contaId: banco });
    void velho;
    // uma despesa paga
    const forn = (await adm.post('/fornecedores', { nome: `Aluguel ${unico()}`, tipo: 'FORNECEDOR' })).body.id;
    const t = (await fin.post('/pagar/titulos', { fornecedorId: forn, descricao: 'Aluguel', vencimento: hoje(), valorCentavos: 100000 })).body;
    await ger.post(`/pagar/titulos/${t.id}/aprovar`);
    await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco });
  });
  afterAll(() => app.close());

  describe('catálogo e permissões', () => {
    it('cada perfil vê os relatórios a que tem direito; Vistoriador, nenhum', async () => {
      expect((await ger.get('/relatorios')).body.map((r: { id: string }) => r.id)).toEqual(['laudos', 'recebimentos', 'inadimplencia', 'pagamentos', 'fluxo-caixa', 'dre']);
      expect((await fin.get('/relatorios')).body.map((r: { id: string }) => r.id)).toEqual(['laudos', 'recebimentos', 'inadimplencia', 'pagamentos', 'fluxo-caixa']); // DRE só se liberado
      expect((await vis.get('/relatorios')).body).toEqual([]);
      expect((await rel(vis, 'laudos')).status).toBe(403);
      expect((await rel(ger, 'inexistente')).status).toBe(404);
    });
  });

  describe('relatório de laudos', () => {
    it('agrupa por cliente com valor, desconto e manuais; o Gerente vê custos e margem, o Financeiro não', async () => {
      const g = (await rel(ger, 'laudos', `agrupar=cliente&de=${diasAtras(0).slice(0, 8)}01`)).body;
      const linha = g.linhas.find((l: { grupo: string }) => l.grupo.startsWith('Auto Center'));
      expect(linha).toMatchObject({ laudos: 3, valor: 51000, desconto: 3000, custos: 12000, margem: 39000 });
      expect(g.colunas.map((c: { chave: string }) => c.chave)).toContain('margem');
      const f = (await rel(fin, 'laudos', 'agrupar=cliente')).body;
      expect(f.colunas.map((c: { chave: string }) => c.chave)).not.toContain('margem');
      expect(JSON.stringify(f.linhas)).not.toContain('custos');
    });
    it('por dia, serviço, vistoriador e forma; totais batem com as linhas; só laudos ativos', async () => {
      for (const ag of ['dia', 'servico', 'vistoriador', 'forma']) {
        const r = (await rel(ger, 'laudos', `agrupar=${ag}&de=${diasAtras(60)}`)).body;
        expect(r.totais.laudos, ag).toBe(r.linhas.reduce((s: number, l: { laudos: number }) => s + l.laudos, 0));
        expect(r.totais.laudos, ag).toBe(5);
      }
    });
    it('recusa agrupamento inválido, período invertido e período longo demais', async () => {
      expect((await rel(ger, 'laudos', 'agrupar=banana')).status).toBe(422);
      expect((await rel(ger, 'laudos', `de=${hoje()}&ate=${diasAtras(5)}`)).status).toBe(422);
      expect((await rel(ger, 'laudos', 'de=2020-01-01')).status).toBe(422);
    });
    it('outra loja e outro grupo veem relatório vazio dos seus dados', async () => {
      expect((await rel(gerA2, 'laudos', 'agrupar=cliente')).body.linhas).toEqual([]);
      expect((await rel(admB, 'laudos', 'agrupar=cliente')).body.linhas).toEqual([]);
    });
  });

  describe('financeiros', () => {
    it('recebimentos por forma e por dia', async () => {
      const r = (await rel(fin, 'recebimentos', 'agrupar=forma')).body;
      expect(r.linhas).toHaveLength(1); expect(r.totais).toMatchObject({ baixas: 2, principal: 36000, recebido: 36000 });
      expect((await rel(fin, 'recebimentos', 'agrupar=dia')).body.linhas[0]).toMatchObject({ grupo: hoje(), recebido: 36000 });
    });
    it('inadimplência: idade dos títulos por cliente (vencido há 40 dias cai em 31 a 60)', async () => {
      const r = (await rel(fin, 'inadimplencia')).body;
      const l = r.linhas.find((x: { grupo: string }) => x.grupo.startsWith('Auto Center'));
      expect(l).toMatchObject({ d60: 18000 });
      expect(l.a_vencer).toBe(15000 + 0); // o laudo à vista com desconto, hoje, ainda não foi pago
      expect(r.totais.total).toBe(l.total + r.linhas.filter((x: { grupo: string }) => !x.grupo.startsWith('Auto Center')).reduce((s: number, x: { total: number }) => s + x.total, 0));
    });
    it('pagamentos por fornecedor e por conta', async () => {
      const r = (await rel(fin, 'pagamentos', 'agrupar=fornecedor')).body;
      expect(r.linhas[0]).toMatchObject({ pago: 100000, pagamentos: 1 });
      expect((await rel(fin, 'pagamentos', 'agrupar=conta')).body.linhas[0].grupo).toBe('Banco');
    });
  });

  describe('exportação', () => {
    it('CSV com BOM, ponto e vírgula e vírgula decimal; fica registrado quem exportou', async () => {
      const r = await ger.get(`/relatorios/laudos?agrupar=cliente&formato=csv&de=${diasAtras(0).slice(0, 8)}01`).buffer(true).parse((res, cb) => { let t = ''; res.setEncoding('utf8'); res.on('data', (d: string) => (t += d)); res.on('end', () => cb(null, t)); });
      expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/text\/csv/); expect(r.headers['content-disposition']).toMatch(/attachment; filename="laudos-/);
      const txt = r.body as unknown as string;
      expect(txt.startsWith('﻿Cliente;Laudos;Valor cobrado;Descontos;Preço manual;Custos;Margem')).toBe(true);
      expect(txt).toMatch(/Auto Center [0-9a-f]+;3;510,00;30,00;0;120,00;390,00/);
      const log = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string; depois: { linhas: number } }[]).find((i) => i.acao === 'relatorio.exportado');
      expect(log?.depois.linhas).toBeGreaterThan(0);
    });
    it('Vistoriador não exporta', async () => {
      expect((await vis.get('/relatorios/laudos?formato=csv')).status).toBe(403);
    });
  });

  describe('painel de início', () => {
    it('Gerente: laudos do mês, a receber, vencido, saldo e série de 30 dias', async () => {
      const p = (await ger.get('/dashboard')).body;
      expect(p).toMatchObject({ perfil: 'GERENTE', laudosHoje: 4, valorHoje: 69000, vencidoCentavos: 18000 });
      expect(p.saldoCaixaCentavos).toBe(36000 - 100000); expect(p.serie).toHaveLength(30);
      expect(p.lojas).toBeUndefined();
    });
    it('Administrativo também vê o resumo da rede, por loja', async () => {
      const p = (await adm.get('/dashboard')).body;
      expect(p.lojas.length).toBe(2);
      expect(p.lojas.find((l: { id: string }) => l.id === A1())).toMatchObject({ laudosMes: expect.any(Number), vencidoCentavos: 18000 });
    });
    it('Financeiro vê o dinheiro mas não a fila de revisão de laudos; Vistoriador vê só os próprios números', async () => {
      const f = (await fin.get('/dashboard')).body;
      expect(f.perfil).toBe('FINANCEIRO'); expect(f.manuaisARevisar).toBeUndefined(); expect(f.aReceberCentavos).toBeGreaterThan(0);
      const v = (await vis.get('/dashboard')).body;
      expect(v).toMatchObject({ perfil: 'VISTORIADOR', vinculado: true }); expect(v.aReceberCentavos).toBeUndefined(); expect(v.saldoCaixaCentavos).toBeUndefined();
      expect(v.laudosHoje).toBe(5 - 1); // os de hoje feitos pela Ana; o faturado antigo não conta
    });
  });

  describe('LGPD', () => {
    it('só o Administrativo vê os dados do titular; o acesso é registrado', async () => {
      expect((await ger.get(`/lgpd/clientes/${cliPf}/dados`)).status).toBe(403);
      const r = await adm.get(`/lgpd/clientes/${cliPf}/dados`);
      expect(r.status).toBe(200); expect(r.body.cliente).toMatchObject({ documento: '52998224725', telefone: '11999998888' }); expect(r.body.laudos).toHaveLength(1);
      expect(((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).some((i) => i.acao === 'lgpd.acesso_titular')).toBe(true);
    });
    it('anonimiza pessoa física: some o que identifica, ficam os lançamentos; empresa e repetição são recusadas', async () => {
      expect((await ger.post(`/lgpd/clientes/${cliPf}/anonimizar`, { motivo: 'Pedido do titular' })).status).toBe(403);
      expect((await adm.post(`/lgpd/clientes/${cli}/anonimizar`, { motivo: 'Pedido do titular' })).status).toBe(409); // empresa
      expect((await adm.post(`/lgpd/clientes/${cliPf}/anonimizar`, { motivo: 'Pedido do titular em 02/11' })).status).toBe(201);
      const d = (await adm.get(`/lgpd/clientes/${cliPf}/dados`)).body;
      expect(d.cliente).toMatchObject({ documento: null, telefone: null, emails: [] }); expect(d.cliente.nome).toMatch(/^Cliente anonimizado /);
      expect(d.laudos).toHaveLength(1); // o lançamento financeiro permanece
      expect((await adm.post(`/lgpd/clientes/${cliPf}/anonimizar`, { motivo: 'Pedido do titular em 02/11' })).status).toBe(409);
      expect((await adm.get(`/clientes/${cliPf}`)).body.status).toBe('INATIVO');
    });
  });
});
