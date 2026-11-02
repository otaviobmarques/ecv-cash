import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dias = (n: number) => new Date(Date.parse(hoje()) + n * 86_400_000).toISOString().slice(0, 10);
const mesAnterior = () => { const [a, m] = hoje().split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7); };
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 71000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('DRE e fluxo de caixa', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C;
  let banco: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const MES = mesAnterior(); const ATUAL = hoje().slice(0, 7);
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  type Linha = Record<string, number | string | boolean>;
  const dre = async (regime: string, c: C = ger) => { const r = await c.get(`/relatorios/dre?agrupar=${regime}&de=${MES}-01&ate=${hoje()}`); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body as { colunas: { chave: string; rotulo: string }[]; linhas: Linha[] }; };
  const linha = (r: { linhas: Linha[] }, rotulo: string) => r.linhas.find((l) => l.linha === rotulo)!;
  const chave = (m: string) => `m${m.replace('-', '_')}`;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2'].map(entrar))) as [C, C, C, C, C];
    const servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    await adm.post(`/servicos/${servico}/custos`, { descricao: 'Taxa do Detran', tipo: 'VALOR', valorCentavos: 4000 });
    const cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}` })).body.id;
    await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    const pix = formas.find((f) => f.nome === 'PIX')!.id; const credito = formas.find((f) => f.nome === 'Cartão de crédito')!.id; const faturado = formas.find((f) => f.nome === 'Faturado')!.id;
    await adm.put(`/formas-pagamento/${credito}/empresas/${A1()}`, { taxaBp: 350, prazoDias: 30, antecipacaoBp: 0 });
    const vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()] })).body.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    await adm.post('/aliquotas', { nome: 'ISS', percentualBp: 200, vigenciaIni: '2025-01-01' });
    await ger.post('/comissoes/regras', { tipo: 'PERCENTUAL', percentualBp: 1000, vigenciaIni: '2025-01-01' });
    const franq = (await adm.post('/fornecedores', { nome: `Franqueadora ${unico()}`, tipo: 'FRANQUEADOR' })).body.id;
    await adm.post('/repasses/regras', { fornecedorId: franq, nome: 'Royalties', tipo: 'PERCENTUAL', percentualBp: 500, base: 'BRUTO', vigenciaIni: '2025-01-01' });
    const lancar = async (formaPagamentoId: string, extra: object = {}) => (await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId, vistoriadorId: vist, ...extra })).body.id as string;
    const l1 = await lancar(pix, { dataLaudo: `${MES}-10` }); const l2 = await lancar(pix, { dataLaudo: `${MES}-10` }); await lancar(pix, { dataLaudo: `${MES}-10` }); const l4 = await lancar(credito, { dataLaudo: `${MES}-12` });
    const tit = async (id: string) => ((await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[]).find((t) => t.laudoId === id)!.id;
    for (const id of [l1, l2]) await ger.post(`/receber/titulos/${await tit(id)}/baixas`, { contaId: banco, data: `${MES}-10` });
    await ger.post(`/receber/titulos/${await tit(l4)}/baixas`, { data: `${MES}-12` });
    const venda = ((await ger.get('/cartao/liquidacoes?situacao=previstas')).body.itens as { id: string }[])[0]!;
    expect((await ger.post(`/cartao/liquidacoes/${venda.id}/liquidar`, { contaId: banco })).status).toBe(201);
    expect((await adm.post('/repasses/apurar', { mes: MES })).body.apuradas).toBe(1);
    const t = (await fin.post('/pagar/titulos', { beneficiario: 'Imobiliária', descricao: 'Aluguel', vencimento: dias(3), competencia: MES, valorCentavos: 50000 })).body;
    await ger.post(`/pagar/titulos/${t.id}/aprovar`); await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco });
    // previsões: laudo faturado (vence em 10 dias), conta a pagar aprovada e uma pendente
    await lancar(faturado);
    const f1 = (await fin.post('/pagar/titulos', { beneficiario: 'Internet', descricao: 'Internet', vencimento: dias(3), valorCentavos: 20000 })).body; await ger.post(`/pagar/titulos/${f1.id}/aprovar`);
    await fin.post('/pagar/titulos', { beneficiario: 'Sistema', descricao: 'Sistema', vencimento: dias(20), valorCentavos: 5000 });
  });
  afterAll(() => app.close());

  describe('DRE por competência', () => {
    it('cada linha do mês dos laudos bate com as contas feitas à mão', async () => {
      const r = await dre('competencia');
      expect(r.colunas.map((c) => c.rotulo)).toEqual(['Linha', `${MES.slice(5)}/${MES.slice(0, 4)}`, `${ATUAL.slice(5)}/${ATUAL.slice(0, 4)}`, 'Total']);
      const m = chave(MES);
      expect(linha(r, 'Receita bruta de serviços')[m]).toBe(72000);
      expect(linha(r, '(−) Impostos sobre o faturamento')[m]).toBe(-1440);
      expect(linha(r, 'Receita líquida')[m]).toBe(70560);
      expect(linha(r, '(−) Custos diretos dos laudos')[m]).toBe(-16000);
      expect(linha(r, 'Lucro bruto')[m]).toBe(54560);
      expect(linha(r, '(−) Comissões dos vistoriadores')[m]).toBe(-7200);
      expect(linha(r, '(−) Royalties e taxas da franquia')[m]).toBe(-3600);
      expect(linha(r, '(−) Taxas de cartão')[m]).toBe(-630);
      expect(linha(r, '(−) Despesas operacionais')[m]).toBe(-50000);
      expect(linha(r, 'Resultado operacional')[m]).toBe(54560 - 7200 - 3600 - 630 - 50000);
      expect(linha(r, 'Resultado do período')[m]).toBe(-6870);
    });
    it('a despesa de competência do mês corrente (internet, sistema) aparece no mês certo; total soma os meses', async () => {
      const r = await dre('competencia');
      const a = chave(ATUAL);
      expect(linha(r, '(−) Despesas operacionais')[a]).toBe(-25000);
      expect(linha(r, 'Receita bruta de serviços')[a]).toBe(18000); // o laudo faturado de hoje
      const res = linha(r, 'Resultado do período');
      expect(res.total).toBe(Number(res[chave(MES)]) + Number(res[a]));
    });
    it('as despesas vêm abertas por conta do plano', async () => {
      const r = await dre('competencia');
      expect(r.linhas.some((l) => l._sub && l.linha === 'Sem classificação')).toBe(true);
    });
  });

  describe('DRE por caixa', () => {
    it('só entra o que entrou e saiu: cartão pelo bruto na data do depósito, taxa como despesa', async () => {
      const r = await dre('caixa');
      const m = chave(MES), a = chave(ATUAL);
      expect(linha(r, 'Receitas recebidas')[m]).toBe(36000);
      expect(linha(r, 'Receitas recebidas')[a]).toBe(18000);
      expect(linha(r, '(−) Taxas de cartão')[a]).toBe(-630);
      expect(linha(r, '(−) Despesas pagas')[a]).toBe(-50000);
      expect(linha(r, '(−) Impostos sobre o que foi recebido')[m]).toBe(-1080); // 2% dos três recebimentos de março (baixa do dia)
      expect(linha(r, 'Resultado de caixa do período').total).toBe(54000 - 1080 - 630 - 50000);
    });
  });

  describe('fluxo de caixa', () => {
    it('realizado: entradas por origem, saídas e saldo acumulado que fecha com o caixa', async () => {
      const r = (await ger.get(`/relatorios/fluxo-caixa?agrupar=realizado&de=${MES}-01&ate=${hoje()}`)).body as { linhas: Linha[]; totais: Record<string, number> };
      expect(r.totais).toMatchObject({ recebimentos: 36000, cartao: 17370, pagamentos: -50000 });
      expect(r.linhas[0]).toMatchObject({ periodo: 'Saldo inicial', saldoFinal: 0 });
      expect(r.linhas[r.linhas.length - 1]).toMatchObject({ periodo: 'Saldo final', saldoFinal: 3370 });
      const contas = (await ger.get('/caixa/contas')).body.contas as { saldoCentavos: number }[];
      expect(contas.reduce((s, c) => s + c.saldoCentavos, 0)).toBe(3370);
    });
    it('projetado: o que vence, o cartão previsto e as contas a pagar (inclusive as aguardando aprovação), com saldo projetado', async () => {
      const r = (await ger.get('/relatorios/fluxo-caixa?agrupar=projetado&dias=60')).body as { titulo: string; linhas: Linha[]; totais: Record<string, number> };
      expect(r.titulo).toContain('projetado');
      expect(r.linhas[0]).toMatchObject({ periodo: 'Saldo de hoje', saldoAcumulado: 3370 });
      expect(r.linhas[1]).toMatchObject({ periodo: 'Vencido e de hoje' });
      expect(Number(r.linhas[1]!.receber)).toBe(18000); // o PIX de março que não foi pago
      expect(r.totais.pagar).toBe(-28600); // 20.000 + 5.000 + 3.600 de royalties ainda aguardando aprovação; expect(r.totais.receber).toBe(36000); // 18000 vencido + 18000 faturado (vence em 10 dias)
      expect(r.linhas[r.linhas.length - 1]!.saldoAcumulado).toBe(3370 + r.totais.saldo_periodo!);
    });
  });

  describe('permissões e exportação', () => {
    it('Vistoriador não vê; o Financeiro só vê o DRE se o Administrativo liberar', async () => {
      expect((await vis.get('/relatorios/dre')).status).toBe(403);
      expect((await fin.get('/relatorios/dre')).status).toBe(403);
      expect((await adm.put('/receber/config', { financeiroVeDre: true })).status).toBe(200);
      expect((await fin.get('/relatorios')).body.map((x: { id: string }) => x.id)).toContain('dre');
      expect((await fin.get(`/relatorios/dre?de=${MES}-01&ate=${hoje()}`)).status).toBe(200);
      await adm.put('/receber/config', { financeiroVeDre: false });
      expect((await fin.get('/relatorios/dre')).status).toBe(403);
    });
    it('exporta o DRE em CSV sem linha de total duplicada, e outra loja não vê números da A1', async () => {
      const r = await ger.get(`/relatorios/dre?agrupar=caixa&de=${MES}-01&ate=${hoje()}&formato=csv`).buffer(true).parse((res, cb) => { let t = ''; res.setEncoding('utf8'); res.on('data', (d: string) => (t += d)); res.on('end', () => cb(null, t)); });
      expect(r.status).toBe(200);
      const txt = r.body as unknown as string;
      expect(txt).toContain('Receitas recebidas;360,00;180,00;540,00');
      expect((await gerA2.get(`/relatorios/dre?de=${MES}-01&ate=${hoje()}`)).body.linhas.every((l: Linha) => l.total === 0)).toBe(true);
    });
  });
});
