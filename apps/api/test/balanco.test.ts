import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dias = (n: number) => new Date(Date.parse(hoje()) + n * 86_400_000).toISOString().slice(0, 10);
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 95000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('balanço gerencial', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C;
  let plano: Record<string, string>;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  type Linha = Record<string, number | string | null>;
  const balanco = async (q = '', c: C = ger) => (await c.get(`/relatorios/balanco?${q}`)) as { status: number; body: { titulo: string; linhas: Linha[] } };
  const v = (r: { linhas: Linha[] }, rotulo: string) => Number(r.linhas.find((l) => l.linha === rotulo)!.valor);

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1'].map(entrar))) as [C, C, C, C];
    plano = Object.fromEntries(((await adm.get('/plano-contas')).body as { id: string; codigo: string }[]).map((c) => [c.codigo, c.id]));
    const servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    const cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}` })).body.id;
    await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[]; const F = (n: string) => formas.find((f) => f.nome === n)!.id;
    await adm.put(`/formas-pagamento/${F('Cartão de débito')}/empresas/${A1()}`, { taxaBp: 150, prazoDias: 1, antecipacaoBp: 0 });
    const vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()] })).body.id;
    const banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 100000, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    const lancar = async (forma: string) => (await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: forma, vistoriadorId: vist })).body.id as string;
    const tit = async (laudo: string) => ((await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[]).find((t) => t.laudoId === laudo)!.id;
    const f1 = await lancar(F('Faturado')); await lancar(F('Faturado')); const d1 = await lancar(F('Cartão de débito')); const c1 = await lancar(F('Cheque'));
    await ger.post(`/receber/titulos/${await tit(f1)}/baixas`, { contaId: banco, principalCentavos: 5000 });
    await ger.post(`/receber/titulos/${await tit(d1)}/baixas`, {});
    await ger.post(`/receber/titulos/${await tit(c1)}/baixas`, { cheque: { numero: '1', emitente: 'Fulano', bomPara: hoje() } });
    const forn = (await adm.post('/fornecedores', { nome: `Forn ${unico()}`, tipo: 'FORNECEDOR' })).body.id;
    const p = (await fin.post('/pagar/titulos', { fornecedorId: forn, descricao: 'Compra', vencimento: dias(5), valorCentavos: 30000 })).body;
    await ger.post(`/pagar/titulos/${p.id}/aprovar`); await ger.post(`/pagar/titulos/${p.id}/pagamentos`, { contaId: banco, principalCentavos: 10000 });
  });
  afterAll(() => app.close());

  it('sem saldos informados: caixa, a receber, cartão, cheque e a pagar vêm do sistema, e o patrimônio líquido fecha a conta', async () => {
    const r = await balanco();
    expect(r.status).toBe(200); expect(r.body.titulo).toBe('Balanço gerencial');
    expect(v(r.body, 'Caixa e bancos')).toBe(95000); // 100.000 + 5.000 recebidos - 10.000 pagos
    expect(v(r.body, 'Contas a receber (laudos em aberto)')).toBe(31000); // 36.000 faturados - 5.000 baixados
    expect(v(r.body, 'Cartões a receber da operadora (líquido de taxas)')).toBe(17730); // 18.000 - 1,5%
    expect(v(r.body, 'Cheques em carteira')).toBe(18000);
    expect(v(r.body, 'Contas a pagar')).toBe(20000);
    expect(v(r.body, 'Total do ativo')).toBe(95000 + 31000 + 17730 + 18000);
    expect(v(r.body, 'Total do passivo + patrimônio líquido')).toBe(v(r.body, 'Total do ativo'));
  });

  it('saldos informados à mão entram nas pontas certas; a diferença vira resultado acumulado', async () => {
    expect((await ger.put('/balanco/saldos', { planoContaId: plano['6.3'], dataBase: hoje(), valorCentavos: 50000 })).status).toBe(403);
    for (const [cod, valor] of [['6.3', 50000], ['7.2', 20000], ['8', 40000]] as const) {
      const r = await adm.put('/balanco/saldos', { planoContaId: plano[cod], dataBase: hoje(), valorCentavos: valor });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const r = await balanco();
    const ativo = 95000 + 31000 + 17730 + 18000 + 50000;
    expect(v(r.body, 'Outros ativos (informados)')).toBe(50000); expect(v(r.body, 'Total do ativo')).toBe(ativo);
    expect(v(r.body, 'Outros passivos (informados)')).toBe(20000); expect(v(r.body, 'Total do passivo')).toBe(40000);
    expect(v(r.body, '8 Patrimônio líquido')).toBe(40000);
    expect(v(r.body, 'Total do patrimônio líquido')).toBe(ativo - 40000);
    expect(v(r.body, 'Resultado acumulado e demais diferenças (calculado)')).toBe(ativo - 40000 - 40000);
    expect(v(r.body, 'Total do passivo + patrimônio líquido')).toBe(ativo);
  });

  it('corrigir o saldo da mesma data troca o valor e deixa o anterior na auditoria', async () => {
    expect((await adm.put('/balanco/saldos', { planoContaId: plano['6.3'], dataBase: hoje(), valorCentavos: 60000, observacao: 'Reavaliação das máquinas' })).status).toBe(200);
    expect(v((await balanco()).body, 'Outros ativos (informados)')).toBe(60000);
    const log = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string; antes: { valorCentavos: number } | null }[]).find((i) => i.acao === 'balanco.saldo_informado' && i.antes);
    expect(log?.antes).toMatchObject({ valorCentavos: 50000 });
  });

  it('data anterior: posição do passado (o saldo informado hoje não vale ontem; ainda não havia laudos)', async () => {
    const r = await balanco(`ate=${dias(-1)}`);
    expect(v(r.body, 'Caixa e bancos')).toBe(100000); expect(v(r.body, 'Contas a receber (laudos em aberto)')).toBe(0);
    expect(r.body.linhas.some((l) => l.linha === 'Outros ativos (informados)')).toBe(false);
  });

  it('recusa conta calculada pelo sistema, conta de resultado, data futura e valor negativo', async () => {
    expect((await adm.put('/balanco/saldos', { planoContaId: plano['6.1'], dataBase: hoje(), valorCentavos: 1 })).status).toBe(409);
    expect((await adm.put('/balanco/saldos', { planoContaId: plano['4.2'], dataBase: hoje(), valorCentavos: 1 })).status).toBe(422);
    expect((await adm.put('/balanco/saldos', { planoContaId: plano['6.3'], dataBase: '2999-01-01', valorCentavos: 1 })).status).toBe(422);
    expect((await adm.put('/balanco/saldos', { planoContaId: plano['6.3'], dataBase: hoje(), valorCentavos: -5 })).status).toBe(422);
    expect((await balanco(`ate=2999-01-01`)).status).toBe(422);
  });

  it('o Gerente vê; o Financeiro só se liberado; o Vistoriador não; o consolidado só o Administrativo', async () => {
    expect((await balanco('', fin)).status).toBe(403); expect((await balanco('', vis)).status).toBe(403);
    expect((await ger.get('/balanco/saldos')).body.saldos.length).toBeGreaterThan(0);
    expect((await fin.get('/balanco/saldos')).status).toBe(403);
    expect((await adm.put('/receber/config', { financeiroVeDre: true })).status).toBe(200);
    expect((await balanco('', fin)).status).toBe(200); await adm.put('/receber/config', { financeiroVeDre: false });
    expect((await balanco('escopo=rede', ger)).status).toBe(403);
    const rede = await balanco('escopo=rede', adm);
    expect(rede.status).toBe(200); expect(rede.body.titulo).toContain('consolidado da rede');
  });

  it('direto no banco, outra loja e outro grupo não leem os saldos', async () => {
    const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }) => (await db.tenant(ctx, (c) => c.query('SELECT 1 FROM saldo_patrimonial_manual'))).rowCount;
    expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] })).toBeGreaterThan(0);
    expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] })).toBe(0);
    expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] })).toBe(0);
  });
});
