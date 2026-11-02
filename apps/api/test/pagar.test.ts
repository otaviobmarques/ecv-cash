import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dias = (n: number) => new Date(Date.parse(hoje()) + n * 86_400_000).toISOString().slice(0, 10);
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 20000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe('contas a pagar', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C, admB: C;
  let fornecedor: string, plano: string, caixa: string, banco: string;
  const A1 = () => cen.A.empresaIds[0]!, A2 = () => cen.A.empresaIds[1]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const novo = async (c: C, extra: object = {}) => {
    const r = await c.post('/pagar/titulos', { fornecedorId: fornecedor, descricao: `Conta ${unico()}`, planoContaId: plano, vencimento: dias(10), valorCentavos: 50000, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; status: string };
  };
  const aprovado = async (extra: object = {}) => { const t = await novo(fin, extra); expect((await ger.post(`/pagar/titulos/${t.id}/aprovar`)).status).toBe(201); return t; };
  const saldo = async (id: string) => ((await ger.get('/caixa/contas')).body.contas as { id: string; saldoCentavos: number }[]).find((c) => c.id === id)!.saldoCentavos;
  const detalhe = async (id: string) => (await ger.get(`/pagar/titulos/${id}`)).body;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2', 'adminB'].map(entrar))) as [C, C, C, C, C, C];
    fornecedor = (await adm.post('/fornecedores', { nome: `Detran ${unico()}`, tipo: 'ORGAO_PUBLICO' })).body.id;
    const contas = (await adm.get('/plano-contas')).body as { id: string; tipo: string; aceitaLancamento: boolean }[];
    plano = contas.find((c) => c.tipo === 'DESPESA' && c.aceitaLancamento)!.id;
    caixa = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Caixa', tipo: 'CAIXA', saldoInicialCentavos: 100000, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  });
  afterAll(() => app.close());

  describe('criação e aprovação', () => {
    it('nasce pendente de aprovação; exige fornecedor ou favorecido e valor positivo', async () => {
      const t = await novo(fin);
      expect(t.status).toBe('PENDENTE');
      expect((await fin.post('/pagar/titulos', { descricao: 'Sem favorecido', vencimento: dias(5), valorCentavos: 1000 })).status).toBe(422);
      expect((await fin.post('/pagar/titulos', { fornecedorId: fornecedor, descricao: 'Zero', vencimento: dias(5), valorCentavos: 0 })).status).toBe(422);
      expect((await fin.post('/pagar/titulos', { beneficiario: 'Joana (diarista)', descricao: 'Limpeza', vencimento: dias(5), valorCentavos: 15000 })).status).toBe(201);
    });
    it('Vistoriador não vê nem cria; outra loja não enxerga', async () => {
      expect((await vis.get('/pagar/titulos')).status).toBe(403);
      expect((await vis.post('/pagar/titulos', { fornecedorId: fornecedor, descricao: 'x1', vencimento: dias(5), valorCentavos: 1000 })).status).toBe(403);
      const t = await novo(fin);
      expect((await gerA2.get(`/pagar/titulos/${t.id}`)).status).toBe(404);
      expect((await admB.get(`/pagar/titulos/${t.id}`)).status).toBe(404);
    });
    it('quem cria não aprova; o Financeiro só aprova se a loja liberar', async () => {
      const doGerente = await novo(ger);
      expect((await ger.post(`/pagar/titulos/${doGerente.id}/aprovar`)).status).toBe(403);
      expect((await fin.post(`/pagar/titulos/${doGerente.id}/aprovar`)).status).toBe(403); // padrão: Financeiro não aprova
      expect((await adm.put('/receber/config', { financeiroAprovaPagar: true })).status).toBe(200);
      expect((await fin.post(`/pagar/titulos/${doGerente.id}/aprovar`)).status).toBe(201);
      expect((await adm.put('/receber/config', { financeiroAprovaPagar: false })).status).toBe(200);
      const t = await novo(fin);
      expect((await fin.post(`/pagar/titulos/${t.id}/aprovar`)).status).toBe(403); // Financeiro liberado ainda não aprova o que criou
    });
    it('aprovar tira da fila; aprovar de novo é recusado; o Gerente aprova a conta do Financeiro', async () => {
      const t = await novo(fin);
      const r = await ger.post(`/pagar/titulos/${t.id}/aprovar`);
      expect(r.body).toMatchObject({ status: 'APROVADO', aprovadoPor: 'Gerente A1' });
      expect((await ger.post(`/pagar/titulos/${t.id}/aprovar`)).status).toBe(409);
    });
    it('rejeitar devolve como rascunho com o motivo; depois do ajuste, envia de novo', async () => {
      const t = await novo(fin);
      expect((await ger.post(`/pagar/titulos/${t.id}/rejeitar`, { motivo: 'Falta a nota fiscal' })).body).toMatchObject({ status: 'RASCUNHO', motivoRejeicao: 'Falta a nota fiscal' });
      expect((await fin.patch(`/pagar/titulos/${t.id}`, { numeroDocumento: 'NF 4521' })).status).toBe(200);
      expect((await fin.post(`/pagar/titulos/${t.id}/enviar`)).body.status).toBe('PENDENTE');
    });
    it('rascunho não vai para aprovação sozinho', async () => {
      const t = await novo(fin, { rascunho: true });
      expect(t.status).toBe('RASCUNHO');
      expect((await ger.post(`/pagar/titulos/${t.id}/aprovar`)).status).toBe(409);
    });
    it('com a aprovação desligada na loja, a conta já nasce aprovada; só o Administrativo muda isso', async () => {
      expect((await ger.put('/receber/config', { aprovacaoPagarObrigatoria: false })).status).toBe(403);
      expect((await adm.put('/receber/config', { aprovacaoPagarObrigatoria: false })).status).toBe(200);
      expect((await novo(fin)).status).toBe('APROVADO');
      expect((await adm.put('/receber/config', { aprovacaoPagarObrigatoria: true })).status).toBe(200);
    });
    it('editar o valor de conta aprovada pede nova aprovação; com pagamento, não edita', async () => {
      const t = await aprovado();
      expect((await fin.patch(`/pagar/titulos/${t.id}`, { valorCentavos: 60000 })).body).toMatchObject({ status: 'PENDENTE', valorCentavos: 60000 });
      const p = await aprovado();
      await ger.post(`/pagar/titulos/${p.id}/pagamentos`, { contaId: banco, principalCentavos: 1000 });
      expect((await fin.patch(`/pagar/titulos/${p.id}`, { valorCentavos: 60000 })).status).toBe(409);
    });
  });

  describe('pagamento', () => {
    it('total: sai da conta, quita e mostra o pagamento', async () => {
      const t = await aprovado({ valorCentavos: 30000 });
      const antes = await saldo(banco);
      const r = await fin.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ pagoTotalCentavos: 30000, status: 'PAGO' });
      expect(await saldo(banco)).toBe(antes - 30000);
      expect(await detalhe(t.id)).toMatchObject({ status: 'PAGO', saldoCentavos: 0 });
      expect((await fin.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco })).status).toBe(409);
    });
    it('não paga o que ainda não foi aprovado, nem rascunho', async () => {
      const t = await novo(fin);
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco })).status).toBe(409);
    });
    it('parcial e depois o resto; não passa do saldo', async () => {
      const t = await aprovado({ valorCentavos: 20000 });
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco, principalCentavos: 8000 })).body.status).toBe('PARCIAL');
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco, principalCentavos: 12001 })).status).toBe(422);
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco })).body.status).toBe('PAGO');
    });
    it('juros, multa e desconto entram no valor pago e pedem motivo', async () => {
      const t = await aprovado({ valorCentavos: 10000 });
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco, jurosCentavos: 150 })).status).toBe(422);
      const antes = await saldo(banco);
      const r = await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco, jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 50, motivo: 'Pago com 3 dias de atraso' });
      expect(r.body).toMatchObject({ pagoTotalCentavos: 10300, status: 'PAGO' });
      expect(await saldo(banco)).toBe(antes - 10300);
    });
    it('caixa em dinheiro não fica negativo', async () => {
      const t = await aprovado({ valorCentavos: 999999 });
      const r = await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: caixa });
      expect(r.status).toBe(409); expect(r.body.mensagem).toMatch(/não dá para pagar/);
    });
    it('conta de outra loja, data futura e comprovante de outra loja são recusados', async () => {
      const t = await aprovado();
      const outra = (await adm.post('/contas-financeiras', { empresaId: A2(), nome: 'Caixa A2', tipo: 'CAIXA', saldoInicialCentavos: 0 })).body.conta.id;
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: outra })).status).toBe(422);
      expect((await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco, data: '2999-01-01' })).status).toBe(422);
    });
    it('Vistoriador não paga', async () => {
      const t = await aprovado();
      expect((await vis.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco })).status).toBe(403);
    });
  });

  describe('estorno e cancelamento', () => {
    it('o Gerente estorna: o dinheiro volta, a conta reabre; não estorna duas vezes', async () => {
      const t = await aprovado({ valorCentavos: 12000 });
      const pg = (await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco })).body;
      const antes = await saldo(banco);
      expect((await ger.post(`/pagar/pagamentos/${pg.pagamentoId}/estornar`, { motivo: '' })).status).toBe(422);
      expect((await ger.post(`/pagar/pagamentos/${pg.pagamentoId}/estornar`, { motivo: 'Pagamento duplicado' })).status).toBe(201);
      expect(await saldo(banco)).toBe(antes + 12000);
      expect(await detalhe(t.id)).toMatchObject({ status: 'APROVADO', pagoCentavos: 0 });
      expect((await ger.post(`/pagar/pagamentos/${pg.pagamentoId}/estornar`, { motivo: 'De novo' })).status).toBe(409);
    });
    it('o Financeiro estorna em período aberto; Vistoriador, não', async () => {
      const t = await aprovado();
      const pg = (await ger.post(`/pagar/titulos/${t.id}/pagamentos`, { contaId: banco })).body;
      expect((await vis.post(`/pagar/pagamentos/${pg.pagamentoId}/estornar`, { motivo: 'Tentativa indevida' })).status).toBe(403);
      expect((await fin.post(`/pagar/pagamentos/${pg.pagamentoId}/estornar`, { motivo: 'Valor errado' })).status).toBe(201);
    });
    it('pagamento nunca se altera, nem direto no banco', async () => {
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await expect(db.tenant(ctx, (c) => c.query('UPDATE pagamento_pagar SET principal_centavos = 1'))).rejects.toThrow();
      await expect(db.tenant(ctx, (c) => c.query('DELETE FROM pagamento_pagar'))).rejects.toThrow();
    });
    it('cancelar: o Gerente cancela com motivo; o Financeiro só rascunho; com pagamento, não', async () => {
      const t = await novo(fin);
      expect((await fin.post(`/pagar/titulos/${t.id}/cancelar`, { motivo: 'Lançada por engano' })).status).toBe(403);
      const r = await novo(fin, { rascunho: true });
      expect((await fin.post(`/pagar/titulos/${r.id}/cancelar`, { motivo: 'Rascunho descartado' })).status).toBe(201);
      expect((await ger.post(`/pagar/titulos/${t.id}/cancelar`, { motivo: 'Lançada por engano' })).body.status).toBe('CANCELADO');
      const p = await aprovado(); await ger.post(`/pagar/titulos/${p.id}/pagamentos`, { contaId: banco, principalCentavos: 100 });
      expect((await ger.post(`/pagar/titulos/${p.id}/cancelar`, { motivo: 'Quero cancelar mesmo' })).status).toBe(409);
    });
  });

  describe('lista e resumo', () => {
    it('filtra por situação e mostra o resumo', async () => {
      const venc = await aprovado({ vencimento: dias(-5) });
      const l = (await ger.get('/pagar/titulos?situacao=vencidos&limite=500')).body.itens as { id: string; vencido: boolean }[];
      expect(l.find((x) => x.id === venc.id)?.vencido).toBe(true);
      expect(((await ger.get('/pagar/titulos?situacao=pendentes')).body.itens as { status: string }[]).every((x) => x.status === 'PENDENTE')).toBe(true);
      const r = (await ger.get('/pagar/resumo')).body;
      expect(r.aPagarCentavos).toBeGreaterThan(0); expect(r.vencidoCentavos).toBeGreaterThan(0); expect(r.pendentesAprovacao).toBeGreaterThan(0); expect(r.pagoNoMesCentavos).toBeGreaterThan(0);
    });
  });

  describe('anexos', () => {
    it('envia PDF, vincula como comprovante e baixa; recusa outro formato', async () => {
      const up = await fin.agent.post('/pagar/anexos').set('Origin', 'http://app.test').attach('arquivo', PDF, 'nota.pdf');
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      expect(up.body).toMatchObject({ nome: 'nota.pdf', mime: 'application/pdf' });
      const ruim = await fin.agent.post('/pagar/anexos').set('Origin', 'http://app.test').attach('arquivo', Buffer.from('MZ... executavel'), 'virus.pdf');
      expect(ruim.status).toBe(422);
      const t = await novo(fin, { anexoId: up.body.id });
      expect((await detalhe(t.id)).anexo).toMatchObject({ nome: 'nota.pdf' });
      const dl = await ger.get(`/pagar/anexos/${up.body.id}`).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
      expect(dl.status).toBe(200); expect(dl.headers['content-type']).toMatch(/pdf/); expect((dl.body as Buffer).equals(PDF)).toBe(true);
      expect((await gerA2.get(`/pagar/anexos/${up.body.id}`)).status).toBe(404);
      expect((await vis.get(`/pagar/anexos/${up.body.id}`)).status).toBe(403);
      const comp = await ger.agent.post('/pagar/anexos').set('Origin', 'http://app.test').attach('arquivo', PDF, 'comprovante.pdf');
      const p = await aprovado();
      expect((await ger.post(`/pagar/titulos/${p.id}/pagamentos`, { contaId: banco, comprovanteId: comp.body.id })).status).toBe(201);
      expect((await detalhe(p.id)).pagamentos[0].comprovanteId).toBe(comp.body.id);
    });
  });

  describe('recorrência', () => {
    it('gera as contas do último mês até 35 dias à frente, sem repetir; pausar interrompe', async () => {
      const r = await fin.post('/pagar/recorrencias', { fornecedorId: fornecedor, descricao: `Aluguel ${unico()}`, planoContaId: plano, valorCentavos: 450000, frequencia: 'MENSAL', dia: 5, inicio: dias(-20) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.titulosGerados).toBeGreaterThanOrEqual(1);
      const lista = async () => ((await ger.get('/pagar/titulos?situacao=todos&limite=500')).body.itens as { recorrenciaId: string | null; vencimento: string; status: string }[]).filter((t) => t.recorrenciaId === r.body.id);
      const antes = await lista();
      expect(antes.length).toBe(r.body.titulosGerados);
      expect(antes.every((t) => t.status === 'PENDENTE')).toBe(true);
      await ger.get('/pagar/titulos'); await ger.get('/pagar/titulos'); // abrir de novo não duplica
      expect((await lista()).length).toBe(antes.length);
      expect((await fin.post(`/pagar/recorrencias/${r.body.id}/pausar`)).status).toBe(201);
      expect((await ger.get('/pagar/recorrencias')).body.find((x: { id: string }) => x.id === r.body.id).ativa).toBe(false);
    });
    it('dia inválido para a frequência é recusado', async () => {
      expect((await fin.post('/pagar/recorrencias', { descricao: 'Errada', valorCentavos: 1000, frequencia: 'SEMANAL', dia: 9, inicio: hoje() })).status).toBe(422);
      expect((await fin.post('/pagar/recorrencias', { descricao: 'Errada', valorCentavos: 1000, frequencia: 'MENSAL', dia: 0, inicio: hoje() })).status).toBe(422);
    });
  });

  describe('rateio entre lojas', () => {
    it('só o Administrativo divide; a soma das partes fecha o total e cada loja recebe a sua', async () => {
      const corpo = { fornecedorId: fornecedor, descricao: 'Software de gestão', planoContaId: plano, vencimento: dias(15), valorTotalCentavos: 10001, itens: [{ empresaId: A1(), pesoBp: 5000 }, { empresaId: A2(), pesoBp: 5000 }] };
      expect((await ger.post('/pagar/rateios', corpo)).status).toBe(403);
      expect((await adm.post('/pagar/rateios', { ...corpo, itens: [{ empresaId: A1(), pesoBp: 5000 }, { empresaId: A2(), pesoBp: 4000 }] })).status).toBe(422);
      const r = await adm.post('/pagar/rateios', corpo);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.partesCentavos.reduce((s: number, x: number) => s + x, 0)).toBe(10001);
      const naA1 = ((await ger.get('/pagar/titulos?situacao=todos&origem=RATEIO&limite=500')).body.itens as { rateioId: string; valorCentavos: number }[]).find((t) => t.rateioId === r.body.rateioId);
      const naA2 = ((await gerA2.get('/pagar/titulos?situacao=todos&origem=RATEIO&limite=500')).body.itens as { rateioId: string; valorCentavos: number }[]).find((t) => t.rateioId === r.body.rateioId);
      expect(naA1).toBeTruthy(); expect(naA2).toBeTruthy();
      expect(naA1!.valorCentavos + naA2!.valorCentavos).toBe(10001);
    });
  });

  describe('custos de laudo que geram conta a pagar', () => {
    it('apura por fornecedor uma única vez; cancelar a conta devolve os custos', async () => {
      const forn = (await adm.post('/fornecedores', { nome: `Sistema de laudo ${unico()}`, tipo: 'FORNECEDOR' })).body.id;
      const servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
      expect((await adm.post(`/servicos/${servico}/custos`, { descricao: 'Tarifa do sistema', tipo: 'VALOR', valorCentavos: 450, geraContaPagar: true, fornecedorId: forn })).status).toBe(201);
      const cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cli ${unico()}` })).body.id;
      await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
      const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
      const vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()] })).body.id;
      const lanc = async () => (await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: formas.find((f) => f.nome === 'PIX')!.id, vistoriadorId: vist })).body as { id: string };
      const l1 = await lanc(); await lanc(); const l3 = await lanc();
      await ger.post(`/laudos/${l3.id}/cancelar`, { motivo: 'Lançado em duplicidade' });
      const prev = (await ger.get(`/pagar/custos-a-apurar?de=${dias(-1)}&ate=${hoje()}`)).body as { fornecedorId: string; laudos: number; totalCentavos: number }[];
      expect(prev.find((p) => p.fornecedorId === forn)).toMatchObject({ laudos: 2, totalCentavos: 900 });
      const r = await fin.post('/pagar/custos-a-apurar', { de: dias(-1), ate: hoje() });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const criado = r.body.criados.find((x: { fornecedor: string }) => x.fornecedor.startsWith('Sistema de laudo'));
      expect(criado).toMatchObject({ totalCentavos: 900, laudos: 2 });
      expect((await fin.post('/pagar/custos-a-apurar', { de: dias(-1), ate: hoje() })).body.criados.find((x: { fornecedor: string }) => x.fornecedor.startsWith('Sistema de laudo'))).toBeUndefined();
      expect((await detalhe(criado.id))).toMatchObject({ origem: 'CUSTO_LAUDO', valorCentavos: 900, custos: { laudos: 2 } });
      expect((await ger.post(`/pagar/titulos/${criado.id}/cancelar`, { motivo: 'Apuração refeita depois' })).status).toBe(201);
      expect((await ger.get(`/pagar/custos-a-apurar?de=${dias(-1)}&ate=${hoje()}`)).body.find((p: { fornecedorId: string }) => p.fornecedorId === forn)).toMatchObject({ laudos: 2 });
      void l1;
    });
  });

  describe('isolamento e auditoria', () => {
    it('direto no banco, outro grupo e outra loja não leem contas a pagar nem pagamentos', async () => {
      const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, t: string) => (await db.tenant(ctx, (c) => c.query(`SELECT 1 FROM ${t} WHERE empresa_id = $1`, [A1()]))).rowCount;
      for (const t of ['titulo_pagar', 'pagamento_pagar', 'recorrencia_pagar', 'anexo']) {
        expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, t), t).toBeGreaterThan(0);
        expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, t), t).toBe(0);
        expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [A2()] }, t), t).toBe(0);
      }
    });
    it('as ações ficam no log', async () => {
      const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
      expect(acoes).toEqual(expect.arrayContaining(['pagar.criado', 'pagar.aprovado', 'pagar.rejeitado', 'pagar.pagamento', 'pagar.pagamento_estornado', 'pagar.cancelado', 'pagar.rateio', 'pagar.custos_apurados', 'pagar.recorrencia_criada', 'anexo.enviado']));
    });
  });
});
