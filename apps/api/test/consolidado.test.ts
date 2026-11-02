import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 91000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('consolidado da rede', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, admA2: C, ger: C, gerA2: C, admB: C;
  const A1 = () => cen.A.empresaIds[0]!, A2 = () => cen.A.empresaIds[1]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  type Linha = Record<string, number | string>;
  const dre = async (q: string, c: C = adm) => (await c.get(`/relatorios/dre?de=${hoje().slice(0, 8)}01&ate=${hoje()}&${q}`)).body as { titulo: string; linhas: Linha[] };
  const total = (r: { linhas: Linha[] }, rotulo: string) => Number(r.linhas.find((l) => l.linha === rotulo)!.total);

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'gerenteA2', 'adminB'].map(entrar))) as [C, C, C, C];
    admA2 = await entrar('adminA');
    await admA2.post('/auth/empresa-ativa', { empresaId: A2() });
    const servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    const pix = formas.find((f) => f.nome === 'PIX')!.id;
    const vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1(), A2()] })).body.id;
    const banco1 = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco A1', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    const banco2 = (await adm.post('/contas-financeiras', { empresaId: A2(), nome: 'Banco A2', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    const novoCliente = async (nome: string) => { const id = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome })).body.id as string; await adm.post(`/clientes/${id}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' }); return id; };
    const externo = await novoCliente(`Auto Center ${unico()}`); const irmao = await novoCliente(`Loja A2 (cliente) ${unico()}`);
    // A1 atende um cliente de fora (R$ 180) e a própria loja A2 (R$ 180, e recebe); A2 atende um cliente de fora (R$ 180)
    const l1 = (await adm.post('/laudos', { placa: placa(), clienteId: externo, servicoId: servico, formaPagamentoId: pix, vistoriadorId: vist })).body.id;
    const l2 = (await adm.post('/laudos', { placa: placa(), clienteId: irmao, servicoId: servico, formaPagamentoId: pix, vistoriadorId: vist })).body.id;
    const l3 = (await admA2.post('/laudos', { placa: placa(), clienteId: externo, servicoId: servico, formaPagamentoId: pix, vistoriadorId: vist })).body.id;
    const t = async (c: C, laudo: string) => ((await c.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[]).find((x) => x.laudoId === laudo)!.id;
    await adm.post(`/receber/titulos/${await t(adm, l1)}/baixas`, { contaId: banco1 }); await adm.post(`/receber/titulos/${await t(adm, l2)}/baixas`, { contaId: banco1 });
    await admA2.post(`/receber/titulos/${await t(admA2, l3)}/baixas`, { contaId: banco2 });
    // A2 paga R$ 180 à loja A1 (fornecedor que é a própria A1) e R$ 100 de aluguel a terceiro
    const fornIrmao = (await adm.post('/fornecedores', { nome: `Loja A1 (fornecedor) ${unico()}`, tipo: 'FRANQUEADOR' })).body.id;
    const pagar = async (fornecedorId: string | undefined, valorCentavos: number) => { const r = (await gerA2.post('/pagar/titulos', { fornecedorId, beneficiario: fornecedorId ? undefined : 'Imobiliária', descricao: 'Despesa', vencimento: hoje(), valorCentavos })).body; await admA2.post(`/pagar/titulos/${r.id}/aprovar`); expect((await admA2.post(`/pagar/titulos/${r.id}/pagamentos`, { contaId: banco2 })).status).toBe(201); };
    await pagar(fornIrmao, 18000); await pagar(undefined, 10000);
    // vínculos (só o Administrativo)
    expect((await ger.put('/grupo/vinculos', { tipo: 'cliente', id: irmao, empresaVinculadaId: A2() })).status).toBe(403);
    expect((await adm.put('/grupo/vinculos', { tipo: 'cliente', id: irmao, empresaVinculadaId: A2() })).status).toBe(200);
    expect((await adm.put('/grupo/vinculos', { tipo: 'fornecedor', id: fornIrmao, empresaVinculadaId: A1() })).status).toBe(200);
  });
  afterAll(() => app.close());

  it('cada loja continua vendo o próprio resultado completo, sem eliminação', async () => {
    expect(total(await dre('agrupar=competencia'), 'Receita bruta de serviços')).toBe(36000); // A1: 180 + 180
    const a2 = await dre('agrupar=competencia', admA2);
    expect(total(a2, 'Receita bruta de serviços')).toBe(18000);
    expect(total(a2, '(−) Despesas operacionais')).toBe(-28000);
  });
  it('consolidado sem eliminar: soma simples das lojas', async () => {
    const r = await dre('agrupar=competencia&escopo=rede&eliminar=0');
    expect(r.titulo).toContain('consolidado da rede');
    expect(total(r, 'Receita bruta de serviços')).toBe(54000);
    expect(total(r, '(−) Despesas operacionais')).toBe(-28000);
  });
  it('consolidado eliminando o intercompany: some a receita da loja irmã e a despesa paga à loja do grupo', async () => {
    const r = await dre('agrupar=competencia&escopo=rede');
    expect(r.titulo).toContain('sem o movimento entre empresas do grupo');
    expect(total(r, 'Receita bruta de serviços')).toBe(36000); // 180 (A1, externo) + 180 (A2, externo)
    expect(total(r, '(−) Despesas operacionais')).toBe(-10000); // só o aluguel
  });
  it('DRE por caixa consolidado elimina o que entrou e saiu entre empresas do grupo', async () => {
    const sem = await dre('agrupar=caixa&escopo=rede&eliminar=0'); const com = await dre('agrupar=caixa&escopo=rede');
    expect(total(sem, 'Receitas recebidas')).toBe(54000); expect(total(com, 'Receitas recebidas')).toBe(36000);
    expect(total(sem, '(−) Despesas pagas')).toBe(-28000); expect(total(com, '(−) Despesas pagas')).toBe(-10000);
  });
  it('fluxo de caixa consolidado: o movimento entre empresas vai para uma coluna própria e o saldo continua batendo com os bancos', async () => {
    const r = (await adm.get(`/relatorios/fluxo-caixa?agrupar=realizado&escopo=rede&de=${hoje().slice(0, 8)}01&ate=${hoje()}`)).body as { colunas: { chave: string }[]; linhas: Linha[]; totais: Record<string, number> };
    expect(r.colunas.map((c) => c.chave)).toContain('internas');
    expect(r.totais.recebimentos).toBe(36000); expect(r.totais.pagamentos).toBe(-10000); expect(r.totais.internas).toBe(18000 - 18000 + 0 + 0);
    const saldoReal = 54000 - 28000; // tudo o que entrou menos tudo o que saiu, nas duas lojas
    expect(r.linhas[r.linhas.length - 1]!.saldoFinal).toBe(saldoReal);
  });
  it('projetado consolidado funciona; só o Administrativo vê o consolidado', async () => {
    expect((await adm.get('/relatorios/fluxo-caixa?agrupar=projetado&escopo=rede')).status).toBe(200);
    expect((await ger.get('/relatorios/dre?escopo=rede')).status).toBe(403);
    expect((await adm.get('/relatorios/laudos?escopo=rede')).status).toBe(403); // só DRE e fluxo
    expect((await admB.get('/relatorios/dre?escopo=rede&agrupar=competencia')).body.linhas.every((l: Linha) => l.total === 0)).toBe(true);
  });
  it('vínculos: lista e desfaz; fica na auditoria; só o Administrativo', async () => {
    expect((await ger.get('/grupo/vinculos')).status).toBe(403);
    const v = (await adm.get('/grupo/vinculos')).body as { clientes: { empresaVinculadaId: string | null }[]; fornecedores: { empresaVinculadaId: string | null }[]; empresas: unknown[] };
    expect(v.clientes.some((c) => c.empresaVinculadaId)).toBe(true); expect(v.empresas).toHaveLength(2);
    const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
    expect(acoes).toContain('consolidado.vinculo');
  });
});
