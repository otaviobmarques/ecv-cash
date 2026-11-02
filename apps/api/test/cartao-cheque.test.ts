import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dias = (n: number) => new Date(Date.parse(hoje()) + n * 86_400_000).toISOString().slice(0, 10);
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 41000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('cartão e cheque', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C;
  let servico: string, cli: string, credito: string, debito: string, chequeForma: string, vist: string, banco: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const lancar = async (forma: string) => (await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: forma, vistoriadorId: vist })).body as { id: string };
  const titulo = async (laudoId: string) => ((await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string; status: string; pagoCentavos: number }[]).find((t) => t.laudoId === laudoId)!;
  const saldo = async () => ((await ger.get('/caixa/contas')).body.contas as { id: string; saldoCentavos: number }[]).find((c) => c.id === banco)!.saldoCentavos;
  const liqs = async (q = 'situacao=todas') => (await ger.get(`/cartao/liquidacoes?${q}`)).body;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2'].map(entrar))) as [C, C, C, C, C];
    servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}` })).body.id;
    await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 20000, vigenciaIni: '2025-01-01' });
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    credito = formas.find((f) => f.nome === 'Cartão de crédito')!.id; debito = formas.find((f) => f.nome === 'Cartão de débito')!.id; chequeForma = formas.find((f) => f.nome === 'Cheque')!.id;
    expect((await adm.put(`/formas-pagamento/${credito}/empresas/${A1()}`, { taxaBp: 350, prazoDias: 30, antecipacaoBp: 0 })).status).toBe(200);
    expect((await adm.put(`/formas-pagamento/${debito}/empresas/${A1()}`, { taxaBp: 150, prazoDias: 1, antecipacaoBp: 0 })).status).toBe(200);
    vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()], usuarioId: cen.A.usuarioIds[3] })).body.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  });
  afterAll(() => app.close());

  describe('cartão', () => {
    it('a baixa no cartão não entra no caixa: vira venda prevista com taxa e data da operadora', async () => {
      const l = await lancar(credito); const t = await titulo(l.id);
      const antes = await saldo();
      const r = await ger.post(`/receber/titulos/${t.id}/baixas`, {});
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ destino: 'CARTAO', recebidoCentavos: 20000, tituloStatus: 'QUITADO' });
      expect(await saldo()).toBe(antes);
      const num = (await ger.get(`/laudos/${l.id}`)).body.numero;
      const v = (await liqs('situacao=previstas')).itens.find((x: { numero: number }) => x.numero === num);
      expect(v).toMatchObject({ brutoCentavos: 20000, taxaCentavos: 700, antecipacaoCentavos: 0, liquidoCentavos: 19300, dataPrevista: dias(30), status: 'PREVISTO', atrasada: false });
    });
    it('débito usa o prazo e a taxa próprios; a agenda soma o que a operadora vai pagar por dia', async () => {
      const l = await lancar(debito); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, {});
      const r = await liqs('situacao=previstas');
      const ag = r.agenda.find((x: { data: string }) => x.data === dias(1));
      expect(ag.liquidoCentavos).toBeGreaterThanOrEqual(19700);
      expect(r.itens.find((i: { dataPrevista: string; taxaCentavos: number }) => i.dataPrevista === dias(1))).toMatchObject({ taxaCentavos: 300, liquidoCentavos: 19700 });
    });
    it('com antecipação, a previsão é no dia seguinte e a antecipação sai do valor', async () => {
      await adm.put(`/formas-pagamento/${credito}/empresas/${A1()}`, { taxaBp: 350, prazoDias: 30, antecipacaoBp: 200 });
      const l = await lancar(credito); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, {});
      const n = (await ger.get(`/laudos/${l.id}`)).body.numero;
      const v = (await liqs('situacao=previstas')).itens.find((x: { numero: number }) => x.numero === n);
      expect(v).toMatchObject({ taxaCentavos: 700, antecipacaoCentavos: 400, liquidoCentavos: 18900, dataPrevista: dias(1) });
      await adm.put(`/formas-pagamento/${credito}/empresas/${A1()}`, { taxaBp: 350, prazoDias: 30, antecipacaoBp: 0 });
    });
    it('liquidar: a operadora paga o líquido na conta; não liquida duas vezes; Vistoriador não', async () => {
      const l = await lancar(debito); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, {});
      const n = (await ger.get(`/laudos/${l.id}`)).body.numero;
      const v = (await liqs('situacao=previstas')).itens.find((x: { numero: number }) => x.numero === n);
      expect((await vis.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco })).status).toBe(403);
      const antes = await saldo();
      const r = await fin.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco });
      expect(r.status, JSON.stringify(r.body)).toBe(201); expect(r.body.liquidoCentavos).toBe(19700);
      expect(await saldo()).toBe(antes + 19700);
      expect((await fin.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco })).status).toBe(409);
    });
    it('depósito menor que o previsto exige motivo e a diferença vira taxa; maior que o previsto é recusado', async () => {
      const l = await lancar(debito); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, {});
      const n = (await ger.get(`/laudos/${l.id}`)).body.numero;
      const v = (await liqs('situacao=previstas')).itens.find((x: { numero: number }) => x.numero === n);
      expect((await ger.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco, liquidoRecebidoCentavos: 19000 })).status).toBe(422);
      expect((await ger.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco, liquidoRecebidoCentavos: 19800, motivo: 'Depósito acima' })).status).toBe(422);
      const antes = await saldo();
      expect((await ger.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco, liquidoRecebidoCentavos: 19000, motivo: 'Operadora descontou tarifa extra' })).status).toBe(201);
      expect(await saldo()).toBe(antes + 19000);
      expect((await liqs('situacao=liquidadas')).itens.find((x: { id: string }) => x.id === v.id)).toMatchObject({ taxaCentavos: 1000, liquidoCentavos: 19000 });
    });
    it('estornar a baixa de venda ainda não paga cancela a venda; paga, exige desfazer a liquidação', async () => {
      const l1 = await lancar(debito); const t1 = await titulo(l1.id);
      const b1 = (await ger.post(`/receber/titulos/${t1.id}/baixas`, {})).body;
      expect((await ger.post(`/receber/baixas/${b1.id}/estornar`, { motivo: 'Cartão recusado depois' })).status).toBe(201);
      expect((await liqs('situacao=canceladas')).itens.length).toBeGreaterThan(0);
      expect((await titulo(l1.id)).status).toBe('ABERTO');
      const l2 = await lancar(debito); const t2 = await titulo(l2.id);
      const b2 = (await ger.post(`/receber/titulos/${t2.id}/baixas`, {})).body;
      const n2 = (await ger.get(`/laudos/${l2.id}`)).body.numero;
      const v = (await liqs('situacao=previstas')).itens.find((x: { numero: number }) => x.numero === n2);
      await ger.post(`/cartao/liquidacoes/${v.id}/liquidar`, { contaId: banco });
      const bloqueado = await ger.post(`/receber/baixas/${b2.id}/estornar`, { motivo: 'Cartão recusado depois' });
      expect(bloqueado.status).toBe(409); expect(bloqueado.body.mensagem).toMatch(/Desfaça a liquidação/);
      const antes = await saldo();
      expect((await fin.post(`/cartao/liquidacoes/${v.id}/desfazer`, { motivo: 'Lançada por engano' })).status).toBe(403); // só Gerente e Administrativo
      expect((await ger.post(`/cartao/liquidacoes/${v.id}/desfazer`, { motivo: 'Lançada por engano' })).status).toBe(201);
      expect(await saldo()).toBe(antes - 19700);
      expect((await ger.post(`/receber/baixas/${b2.id}/estornar`, { motivo: 'Cartão recusado depois' })).status).toBe(201);
    });
    it('liquidação em lote: as boas entram, as já pagas voltam com o motivo', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) { const l = await lancar(debito); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, {}); const n = (await ger.get(`/laudos/${l.id}`)).body.numero; ids.push((await liqs('situacao=previstas')).itens.find((x: { numero: number }) => x.numero === n).id); }
      await ger.post(`/cartao/liquidacoes/${ids[0]}/liquidar`, { contaId: banco });
      const r = await ger.post('/cartao/liquidacoes/lote', { ids, contaId: banco });
      expect(r.body).toMatchObject({ liquidadas: 1, erros: 1 });
    });
    it('vendas vencidas e não liquidadas aparecem como atrasadas', async () => {
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await db.tenant(ctx, (c) => c.query(`UPDATE liquidacao_cartao SET data_venda = data_venda - 40, data_prevista = data_prevista - 40 WHERE status = 'PREVISTO' AND id = (SELECT id FROM liquidacao_cartao WHERE status = 'PREVISTO' ORDER BY criado_em LIMIT 1)`));
      expect((await liqs('situacao=atrasadas')).itens.length).toBe(1);
    });
  });

  describe('cheque', () => {
    const dadosCheque = (extra: object = {}) => ({ numero: '000123', banco: 'Banco Exemplo', emitente: 'Auto Center Silva', bomPara: dias(0), ...extra });
    it('a baixa em cheque pede os dados do cheque e não entra no caixa', async () => {
      const l = await lancar(chequeForma); const t = await titulo(l.id);
      expect((await ger.post(`/receber/titulos/${t.id}/baixas`, {})).status).toBe(422);
      const antes = await saldo();
      const r = await ger.post(`/receber/titulos/${t.id}/baixas`, { cheque: dadosCheque() });
      expect(r.status, JSON.stringify(r.body)).toBe(201); expect(r.body.destino).toBe('CHEQUE');
      expect(await saldo()).toBe(antes);
      const lista = (await ger.get('/cheques?situacao=recebidos')).body;
      expect(lista.itens.find((c: { numero: string; valorCentavos: number }) => c.numero === '000123')).toMatchObject({ valorCentavos: 20000, status: 'RECEBIDO', podeDepositar: true });
      expect(lista.resumo.naMaoCentavos).toBeGreaterThanOrEqual(20000);
    });
    it('ciclo: recebido, depositado, compensado: o dinheiro só entra na compensação', async () => {
      const l = await lancar(chequeForma); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, { cheque: dadosCheque({ numero: '555' }) });
      const k = (await ger.get('/cheques?situacao=recebidos')).body.itens.find((c: { numero: string }) => c.numero === '555');
      expect((await vis.post(`/cheques/${k.id}/depositar`, { contaId: banco })).status).toBe(403);
      expect((await ger.post(`/cheques/${k.id}/compensar`, {})).status).toBe(409); // ainda não depositado
      const antes = await saldo();
      expect((await fin.post(`/cheques/${k.id}/depositar`, { contaId: banco })).status).toBe(201);
      expect(await saldo()).toBe(antes);
      expect((await fin.post(`/cheques/${k.id}/compensar`, {})).status).toBe(201);
      expect(await saldo()).toBe(antes + 20000);
      expect((await ger.get('/cheques?situacao=compensados')).body.itens.some((c: { id: string }) => c.id === k.id)).toBe(true);
    });
    it('não deposita antes do bom para', async () => {
      const l = await lancar(chequeForma); await ger.post(`/receber/titulos/${(await titulo(l.id)).id}/baixas`, { cheque: dadosCheque({ numero: '777', bomPara: dias(15) }) });
      const k = (await ger.get('/cheques?situacao=recebidos')).body.itens.find((c: { numero: string }) => c.numero === '777');
      expect(k.podeDepositar).toBe(false);
      const r = await ger.post(`/cheques/${k.id}/depositar`, { contaId: banco });
      expect(r.status).toBe(409); expect(r.body.mensagem).toMatch(/bom para/);
    });
    it('cheque devolvido reabre o título e, se já compensado, tira o dinheiro da conta', async () => {
      const l = await lancar(chequeForma); const t = await titulo(l.id);
      await ger.post(`/receber/titulos/${t.id}/baixas`, { cheque: dadosCheque({ numero: '888' }) });
      const k = (await ger.get('/cheques?situacao=recebidos')).body.itens.find((c: { numero: string }) => c.numero === '888');
      await ger.post(`/cheques/${k.id}/depositar`, { contaId: banco }); await ger.post(`/cheques/${k.id}/compensar`, {});
      const antes = await saldo();
      expect((await ger.post(`/cheques/${k.id}/devolver`, { motivo: '' })).status).toBe(422);
      const r = await ger.post(`/cheques/${k.id}/devolver`, { motivo: 'Cheque sem fundos (alínea 11)' });
      expect(r.status, JSON.stringify(r.body)).toBe(201); expect(r.body.tituloStatus).toBe('ABERTO');
      expect(await saldo()).toBe(antes - 20000);
      expect((await titulo(l.id)).status).toBe('ABERTO');
      expect((await ger.post(`/cheques/${k.id}/devolver`, { motivo: 'De novo' })).status).toBe(409);
    });
    it('estornar a baixa de cheque ainda na mão o cancela; depositado, só pela devolução', async () => {
      const l1 = await lancar(chequeForma); const b1 = (await ger.post(`/receber/titulos/${(await titulo(l1.id)).id}/baixas`, { cheque: dadosCheque({ numero: '901' }) })).body;
      expect((await ger.post(`/receber/baixas/${b1.id}/estornar`, { motivo: 'Cliente trocou a forma' })).status).toBe(201);
      const l2 = await lancar(chequeForma); const b2 = (await ger.post(`/receber/titulos/${(await titulo(l2.id)).id}/baixas`, { cheque: dadosCheque({ numero: '902' }) })).body;
      const k = (await ger.get('/cheques?situacao=recebidos')).body.itens.find((c: { numero: string }) => c.numero === '902');
      await ger.post(`/cheques/${k.id}/depositar`, { contaId: banco });
      const r = await ger.post(`/receber/baixas/${b2.id}/estornar`, { motivo: 'Cliente trocou a forma' });
      expect(r.status).toBe(409); expect(r.body.mensagem).toMatch(/devolução do cheque/);
    });
    it('outra loja não enxerga cheques nem vendas de cartão', async () => {
      expect((await gerA2.get('/cheques?situacao=todos')).body.itens).toEqual([]);
      expect((await gerA2.get('/cartao/liquidacoes?situacao=todas')).body.itens).toEqual([]);
      const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, t: string) => (await db.tenant(ctx, (c) => c.query(`SELECT 1 FROM ${t}`))).rowCount;
      for (const t of ['liquidacao_cartao', 'cheque']) {
        expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, t), t).toBe(0);
        expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] }, t), t).toBe(0);
      }
    });
  });
});
