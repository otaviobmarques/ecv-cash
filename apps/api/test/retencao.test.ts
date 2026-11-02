import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const anosAtras = (n: number) => `${Number(hoje().slice(0, 4)) - n}${hoje().slice(4)}`.replace('-02-29', '-02-28');
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 99000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('LGPD: prazo de retenção', () => {
  let app: INestApplication; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C; let antigo: string, recente: string, devendo: string, novoSemLaudo: string;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const retencao = async (anos = 5) => (await adm.get(`/lgpd/retencao?anos=${anos}`)).body as { itens: { id: string; documento: string | null; nuncaTeveLaudo: boolean }[] };

  beforeAll(async () => {
    ({ app } = await subirApp());
    cen = await criarCenario((app as never as { get: (t: unknown) => never }).get((await import('../src/db/db.service')).DbService));
    [adm, ger] = (await Promise.all(['adminA', 'gerenteA1'].map(entrar))) as [C, C];
    const servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    const pix = ((await adm.get('/formas-pagamento')).body as { id: string; nome: string }[]).find((f) => f.nome === 'PIX')!.id;
    const vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [cen.A.empresaIds[0]] })).body.id;
    const banco = (await adm.post('/contas-financeiras', { empresaId: cen.A.empresaIds[0], nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2010-01-01' })).body.conta.id;
    const pf = async (nome: string, doc: string) => { const id = (await adm.post('/clientes', { tipoPessoa: 'PF', nome: `${nome} ${unico()}`, documento: doc })).body.id as string; await adm.post(`/clientes/${id}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2010-01-01' }); return id; };
    const laudo = async (cli: string, data: string, pagar: boolean) => {
      const l = (await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: pix, vistoriadorId: vist, dataLaudo: data })).body.id;
      if (pagar) { const t = ((await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[]).find((x) => x.laudoId === l)!.id; await ger.post(`/receber/titulos/${t}/baixas`, { contaId: banco, data }); }
    };
    antigo = await pf('Antigo', '52998224725'); await laudo(antigo, anosAtras(6), true);
    recente = await pf('Recente', '11144477735'); await laudo(recente, anosAtras(1), true);
    devendo = await pf('Devendo', '39053344705'); await laudo(devendo, anosAtras(6), false);
    novoSemLaudo = await pf('Sem laudo', '15350946056');
  });
  afterAll(() => app.close());

  it('lista só quem está parado há 5 anos ou mais, sem valor em aberto, com o CPF mascarado', async () => {
    const r = await retencao();
    const ids = r.itens.map((i) => i.id);
    expect(ids).toContain(antigo); expect(ids).not.toContain(recente); expect(ids).not.toContain(devendo); expect(ids).not.toContain(novoSemLaudo);
    expect(r.itens.find((i) => i.id === antigo)!.documento).toBe('•••.982.•••-25');
  });

  it('o prazo mínimo é de 5 anos (guarda legal); só o Administrativo; prazo maior filtra mais', async () => {
    expect((await adm.get('/lgpd/retencao?anos=2')).status).toBe(422);
    expect((await ger.get('/lgpd/retencao')).status).toBe(403);
    expect((await retencao(8)).itens.map((i) => i.id)).not.toContain(antigo);
  });

  it('anonimiza em lote só quem cumpre o prazo; os outros voltam com o motivo; os lançamentos ficam', async () => {
    const r = await adm.post('/lgpd/retencao/anonimizar', { ids: [antigo, recente, devendo], anos: 5 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ anonimizados: 1, erros: 2 });
    expect(r.body.resultados.find((x: { id: string }) => x.id === recente).erro).toMatch(/Não cumpre o prazo de 5 anos/);
    const dados = (await adm.get(`/lgpd/clientes/${antigo}/dados`)).body;
    expect(dados.cliente).toMatchObject({ documento: null }); expect(dados.cliente.nome).toMatch(/^Cliente anonimizado /); expect(dados.laudos).toHaveLength(1);
    expect((await retencao()).itens.map((i) => i.id)).not.toContain(antigo);
    const motivo = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string; motivo: string | null }[]).find((i) => i.acao === 'lgpd.anonimizado')!.motivo;
    expect(motivo).toBe('Prazo de retenção de 5 anos vencido');
  });

  it('o Gerente não anonimiza em lote', async () => {
    expect((await ger.post('/lgpd/retencao/anonimizar', { ids: [recente], anos: 5 })).status).toBe(403);
  });
});
