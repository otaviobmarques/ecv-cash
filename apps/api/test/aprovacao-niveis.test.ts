import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

describe('aprovação de contas a pagar em níveis', () => {
  let app: INestApplication; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C; let forn: string;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const criar = async (c: C, valorCentavos: number) => (await c.post('/pagar/titulos', { fornecedorId: forn, descricao: `Conta ${unico()}`, vencimento: hoje(), valorCentavos })).body as { id: string };
  const det = async (id: string) => (await adm.get(`/pagar/titulos/${id}`)).body as { status: string; aprovacoes: { perfil: string }[]; requisitos: { aprovacoes: number; administrativoBasta: boolean; somenteAdministrativo: boolean } };

  beforeAll(async () => {
    ({ app } = await subirApp());
    cen = await criarCenario((app as never as { get: (t: unknown) => never }).get((await import('../src/db/db.service')).DbService));
    [adm, ger, fin] = (await Promise.all(['adminA', 'gerenteA1', 'finA1'].map(entrar))) as [C, C, C];
    forn = (await adm.post('/fornecedores', { nome: `Forn ${unico()}`, tipo: 'FORNECEDOR' })).body.id;
  });
  afterAll(() => app.close());

  it('configurar: só o Administrativo; a dupla aprovação não pode ficar abaixo do limite do Gerente; vazio desliga', async () => {
    expect((await ger.put('/receber/config', { aprovacaoLimiteGerenteCentavos: 100000 })).status).toBe(403);
    expect((await adm.put('/receber/config', { aprovacaoLimiteGerenteCentavos: 100000, aprovacaoDuplaAcimaCentavos: 50000 })).status).toBe(422);
    const r = await adm.put('/receber/config', { aprovacaoLimiteGerenteCentavos: 100000, aprovacaoDuplaAcimaCentavos: 500000 });
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body).toMatchObject({ aprovacaoLimiteGerenteCentavos: 100000, aprovacaoDuplaAcimaCentavos: 500000 });
    expect((await adm.get('/receber/config')).body.aprovacaoLimiteGerenteCentavos).toBe(100000);
  });

  it('até o limite do Gerente: o Gerente aprova com uma aprovação', async () => {
    const t = await criar(fin, 50000);
    expect((await det(t.id)).requisitos).toEqual({ somenteAdministrativo: false, aprovacoes: 1, administrativoBasta: true });
    expect((await ger.post(`/pagar/titulos/${t.id}/aprovar`)).body).toMatchObject({ status: 'APROVADO', aprovacoesDadas: 1, aprovacoesNecessarias: 1 });
  });

  it('acima do limite do Gerente: só o Administrativo aprova', async () => {
    const t = await criar(fin, 200000);
    expect((await det(t.id)).requisitos).toMatchObject({ somenteAdministrativo: true, aprovacoes: 1 });
    const r = await ger.post(`/pagar/titulos/${t.id}/aprovar`);
    expect(r.status).toBe(403); expect(r.body.mensagem).toBe('Contas acima de R$ 1.000,00 só o Administrativo aprova.');
    expect((await adm.post(`/pagar/titulos/${t.id}/aprovar`)).body.status).toBe('APROVADO');
  });

  it('acima do valor de dupla aprovação: o Administrativo sozinho basta, ou duas pessoas diferentes', async () => {
    const t1 = await criar(fin, 600000);
    expect((await det(t1.id)).requisitos).toEqual({ somenteAdministrativo: false, aprovacoes: 2, administrativoBasta: true });
    expect((await adm.post(`/pagar/titulos/${t1.id}/aprovar`)).body).toMatchObject({ status: 'APROVADO', aprovacoesDadas: 1 });
    // sem o Administrativo: o Gerente e o Financeiro (liberado) juntos aprovam
    expect((await adm.put('/receber/config', { financeiroAprovaPagar: true })).status).toBe(200);
    const t2 = await criar(adm, 600000);
    expect((await ger.post(`/pagar/titulos/${t2.id}/aprovar`)).body).toMatchObject({ status: 'PENDENTE', aprovacoesDadas: 1, aprovacoesNecessarias: 2 });
    expect((await ger.post(`/pagar/titulos/${t2.id}/aprovar`)).status).toBe(409); // a mesma pessoa não conta duas vezes
    expect((await fin.post(`/pagar/titulos/${t2.id}/aprovar`)).body).toMatchObject({ status: 'APROVADO', aprovacoesDadas: 2 });
    // o Administrativo que criou aprova sozinho
    const t3 = await criar(adm, 600000);
    expect((await adm.post(`/pagar/titulos/${t3.id}/aprovar`)).body.status).toBe('APROVADO');
    expect((await adm.put('/receber/config', { financeiroAprovaPagar: false })).status).toBe(200);
  });

  it('o Administrativo aprova a própria conta; Gerente e Financeiro, nunca a que criaram', async () => {
    const t = await criar(adm, 50000);
    expect((await adm.post(`/pagar/titulos/${t.id}/aprovar`)).body.status).toBe('APROVADO');
    const g = await criar(ger, 50000);
    expect((await ger.post(`/pagar/titulos/${g.id}/aprovar`)).status).toBe(403);
    expect((await adm.post(`/pagar/titulos/${g.id}/aprovar`)).body.status).toBe('APROVADO');
  });

  it('mudar o valor depois de aprovações parciais invalida as aprovações', async () => {
    const t = await criar(fin, 600000);
    await ger.post(`/pagar/titulos/${t.id}/aprovar`);
    expect((await det(t.id)).aprovacoes).toHaveLength(1);
    expect((await fin.patch(`/pagar/titulos/${t.id}`, { valorCentavos: 700000 })).status).toBe(200);
    expect((await det(t.id)).aprovacoes).toHaveLength(0);
    expect((await adm.post(`/pagar/titulos/${t.id}/aprovar`)).body).toMatchObject({ status: 'APROVADO', aprovacoesDadas: 1 }); // pode aprovar de novo
  });

  it('sem limites configurados, volta ao comportamento de antes; as aprovações parciais ficam no log', async () => {
    expect((await adm.put('/receber/config', { aprovacaoLimiteGerenteCentavos: null, aprovacaoDuplaAcimaCentavos: null })).status).toBe(200);
    const t = await criar(fin, 9_000_000);
    expect((await ger.post(`/pagar/titulos/${t.id}/aprovar`)).body.status).toBe('APROVADO');
    const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
    expect(acoes).toEqual(expect.arrayContaining(['pagar.aprovacao_parcial', 'pagar.aprovado']));
  });
});
