import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { SENHA, cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 0;
/** Placa Mercosul única por chamada, para os testes não esbarrarem no aviso de duplicidade. */
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('laudos', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  let adm: ReturnType<typeof cliente>, ger: ReturnType<typeof cliente>, fin: ReturnType<typeof cliente>, vis: ReturnType<typeof cliente>, gerA2: ReturnType<typeof cliente>, admB: ReturnType<typeof cliente>;
  let servicoId: string, clienteId: string, semPrecoId: string, semPreco2Id: string, faturado: string, pix: string, vistAna: string, vistJoao: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const base = (extra: object = {}) => ({ placa: placa(), clienteId, servicoId, formaPagamentoId: faturado, ...extra });
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2', 'adminB'].map(entrar))) as [typeof adm, typeof adm, typeof adm, typeof adm, typeof adm, typeof adm];
    servicoId = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    await adm.post(`/servicos/${servicoId}/custos`, { descricao: 'Taxa Detran', tipo: 'VALOR', valorCentavos: 3800 });
    await adm.post(`/servicos/${servicoId}/custos`, { descricao: 'Repasse', tipo: 'PERCENTUAL', percentualBp: 500 });
    clienteId = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Auto Center ${unico()}` })).body.id;
    await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 18000, vigenciaIni: '2026-01-01' });
    semPrecoId = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Sem preço ${unico()}` })).body.id;
    semPreco2Id = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Sem preço 2 ${unico()}` })).body.id;
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    faturado = formas.find((f) => f.nome === 'Faturado')!.id; pix = formas.find((f) => f.nome === 'PIX')!.id;
    vistAna = (await adm.post('/vistoriadores', { nome: 'Ana Souza', empresaIds: [A1()], usuarioId: cen.A.usuarioIds[3] })).body.id;
    vistJoao = (await adm.post('/vistoriadores', { nome: 'João Silva', empresaIds: [A1()] })).body.id;
  });
  afterAll(() => app.close());

  describe('lançamento', () => {
    it('o Vistoriador lança com o preço da tabela, gravado no laudo, e é ele o vistoriador', async () => {
      const r = await vis.post('/laudos', base({ placa: 'rtx-4f21', observacao: 'Pneu gasto' }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ placa: 'RTX4F21', precoTabelaCentavos: 18000, valorCobradoCentavos: 18000, descontoCentavos: 0, precoManual: false, vistoriadorId: vistAna, status: 'ATIVO', dataLaudo: hoje() });
      expect(r.body.numero).toBeGreaterThan(0);
    });
    it('o Vistoriador não vê custo nem margem; o Gerente vê, com o custo gravado (R$ 38 + 5% = R$ 47)', async () => {
      const r = await vis.post('/laudos', base());
      expect(r.body.custosCentavos).toBeUndefined(); expect(r.body.margemCentavos).toBeUndefined();
      const g = await ger.get(`/laudos/${r.body.id}`);
      expect(g.body).toMatchObject({ custosCentavos: 4700, margemCentavos: 13300 });
      expect((g.body.custos as { descricao: string; valorCentavos: number }[]).map((c) => [c.descricao, c.valorCentavos]).sort()).toEqual([['Repasse', 900], ['Taxa Detran', 3800]]);
      expect(((await fin.get(`/laudos/${r.body.id}`)).body).margemCentavos).toBeUndefined();
    });
    it('reajuste de preço e mudança de custo depois não mexem em laudo já lançado', async () => {
      const novoCliente = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Reajuste ${unico()}` })).body.id;
      await adm.post(`/clientes/${novoCliente}/precos`, { servicoId, valorCentavos: 20000, vigenciaIni: '2026-01-01' });
      const l = (await vis.post('/laudos', { ...base(), clienteId: novoCliente })).body;
      const custoId = ((await adm.get('/servicos')).body as { id: string; custos: { id: string; descricao: string }[] }[]).find((s) => s.id === servicoId)!.custos.find((c) => c.descricao === 'Taxa Detran')!.id;
      await adm.patch(`/servicos/${servicoId}/custos/${custoId}`, { descricao: 'Taxa Detran', tipo: 'VALOR', valorCentavos: 9900 });
      await adm.post(`/clientes/${novoCliente}/precos`, { servicoId, valorCentavos: 25000, vigenciaIni: hoje(), motivo: 'Reajuste de tabela' }).catch(() => undefined);
      const depois = (await ger.get(`/laudos/${l.id}`)).body;
      expect(depois).toMatchObject({ precoTabelaCentavos: 20000, valorCobradoCentavos: 20000, custosCentavos: 3800 + 1000 });
      await adm.patch(`/servicos/${servicoId}/custos/${custoId}`, { descricao: 'Taxa Detran', tipo: 'VALOR', valorCentavos: 3800 });
    });
    it('placa inválida, cliente, serviço ou forma inexistentes são recusados com a mensagem no campo', async () => {
      const r = await vis.post('/laudos', base({ placa: 'AB12345' }));
      expect(r.status).toBe(422); expect(r.body.campos.placa).toMatch(/inválida/);
      expect((await vis.post('/laudos', base({ clienteId: '00000000-0000-0000-0000-000000000000' }))).status).toBeGreaterThanOrEqual(400);
    });
    it('número do laudo repetido entre ativos é recusado; depois de cancelar, o número volta a servir', async () => {
      const n = `N-${unico()}`;
      const a = await ger.post('/laudos', base({ vistoriadorId: vistJoao, numeroLaudo: n }));
      expect(a.status).toBe(201);
      const b = await ger.post('/laudos', base({ vistoriadorId: vistJoao, numeroLaudo: n }));
      expect(b.status).toBe(422); expect(b.body.campos.numeroLaudo).toMatch(/número/);
      expect((await adm.post(`/laudos/${a.body.id}/cancelar`, { motivo: 'Lançado em duplicidade' })).status).toBe(201);
      expect((await ger.post('/laudos', base({ vistoriadorId: vistJoao, numeroLaudo: n }))).status).toBe(201);
    });
  });

  describe('cliente sem preço', () => {
    let id: string;
    it('exige o valor digitado e marca o laudo como preço manual', async () => {
      const sem = await vis.post('/laudos', base({ clienteId: semPrecoId }));
      expect(sem.status).toBe(422); expect(sem.body.campos.valorManualCentavos).toMatch(/não tem preço/);
      const ok = await vis.post('/laudos', base({ clienteId: semPrecoId, valorManualCentavos: 14000 }));
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ precoManual: true, precoTabelaCentavos: null, valorCobradoCentavos: 14000, descontoCentavos: 0 });
      id = ok.body.id;
    });
    it('aparece para o Gerente revisar; o Vistoriador não revisa', async () => {
      const lista = (await ger.get('/laudos?revisar=1')).body.itens as { id: string }[];
      expect(lista.map((l) => l.id)).toContain(id);
      expect((await vis.post(`/laudos/${id}/revisar`, { promoverPreco: true })).status).toBe(403);
    });
    it('revisar com “promover” cadastra o valor como preço do cliente; só se revisa uma vez', async () => {
      const r = await ger.post(`/laudos/${id}/revisar`, { promoverPreco: true });
      expect(r.status).toBe(201); expect(r.body.revisadoEm).toBeTruthy();
      expect((await ger.get('/laudos?revisar=1')).body.itens.map((l: { id: string }) => l.id)).not.toContain(id);
      const v = (await vis.get(`/precos/vigente?clienteId=${semPrecoId}&servicoId=${servicoId}`)).body.preco;
      expect(v.valorCentavos).toBe(14000);
      expect((await ger.post(`/laudos/${id}/revisar`, {})).status).toBe(409);
    });
    it('laudo que usou preço da tabela não tem o que revisar', async () => {
      const l = (await vis.post('/laudos', base())).body;
      expect((await ger.post(`/laudos/${l.id}/revisar`, {})).status).toBe(400);
    });
  });

  describe('desconto e valor diferente da tabela', () => {
    it('o Vistoriador não cobra valor diferente; o Gerente pode, mas com motivo', async () => {
      expect((await vis.post('/laudos', base({ valorCobradoCentavos: 15000, ajusteMotivo: 'Cliente antigo' }))).status).toBe(403);
      const sem = await ger.post('/laudos', base({ vistoriadorId: vistJoao, valorCobradoCentavos: 16500 }));
      expect(sem.status).toBe(422); expect(sem.body.campos.ajusteMotivo).toBeTruthy();
      const ok = await ger.post('/laudos', base({ vistoriadorId: vistJoao, valorCobradoCentavos: 16500, ajusteMotivo: 'Cliente antigo, combinado por telefone' }));
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ precoTabelaCentavos: 18000, valorCobradoCentavos: 16500, descontoCentavos: 1500, ajusteMotivo: 'Cliente antigo, combinado por telefone' });
      expect((await ger.get(`/laudos/${ok.body.id}`)).body.custosCentavos).toBe(3800 + 825); // o percentual vale sobre o que foi cobrado
    });
    it('a tabela repetida como valor cobrado não é desconto e não pede motivo', async () => {
      expect((await vis.post('/laudos', base({ valorCobradoCentavos: 18000 }))).status).toBe(201);
    });
  });

  describe('data do laudo', () => {
    it('o Vistoriador lança só do dia; ninguém lança no futuro; o Gerente lança datas passadas', async () => {
      expect((await vis.post('/laudos', base({ dataLaudo: '2026-02-10' }))).status).toBe(422);
      expect((await ger.post('/laudos', base({ vistoriadorId: vistJoao, dataLaudo: '2999-01-01' }))).status).toBe(422);
      const ok = await ger.post('/laudos', base({ vistoriadorId: vistJoao, dataLaudo: '2026-02-10' }));
      expect(ok.status).toBe(201); expect(ok.body.dataLaudo).toBe('2026-02-10');
    });
    it('o preço usado é o vigente na data do laudo (antes de qualquer preço, vira manual)', async () => {
      const antes = await ger.post('/laudos', base({ vistoriadorId: vistJoao, dataLaudo: '2025-06-01' }));
      expect(antes.status).toBe(422);
      const manual = await ger.post('/laudos', base({ vistoriadorId: vistJoao, dataLaudo: '2025-06-01', valorManualCentavos: 17000 }));
      expect(manual.body).toMatchObject({ precoManual: true, valorCobradoCentavos: 17000 });
    });
  });

  describe('duplicidade', () => {
    const p = placa();
    it('mesma placa, serviço, data e loja: avisa e bloqueia o Vistoriador', async () => {
      expect((await ger.post('/laudos', base({ placa: p, vistoriadorId: vistJoao }))).status).toBe(201);
      const r = await vis.post('/laudos', base({ placa: p }));
      expect(r.status).toBe(409); expect(r.body).toMatchObject({ codigo: 'DUPLICADO', podeLiberar: false });
      expect(r.body.mensagem).toMatch(/peça ao gerente/i);
      const forcar = await vis.post('/laudos', base({ placa: p, confirmarDuplicidade: true, motivoDuplicidade: 'Refazendo o laudo' }));
      expect(forcar.status).toBe(409);
    });
    it('o Gerente libera com confirmação e motivo; o motivo fica no laudo', async () => {
      const r = await ger.post('/laudos', base({ placa: p, vistoriadorId: vistJoao }));
      expect(r.status).toBe(409); expect(r.body.podeLiberar).toBe(true);
      expect((await ger.post('/laudos', base({ placa: p, vistoriadorId: vistJoao, confirmarDuplicidade: true }))).status).toBe(409);
      const ok = await ger.post('/laudos', base({ placa: p, vistoriadorId: vistJoao, confirmarDuplicidade: true, motivoDuplicidade: 'Vistoria refeita a pedido do cliente' }));
      expect(ok.status).toBe(201); expect(ok.body.duplicidadeMotivo).toMatch(/refeita/);
    });
    it('outro serviço, outra data ou outra loja não é duplicidade; laudo cancelado não conta', async () => {
      const q = placa();
      const a = await ger.post('/laudos', base({ placa: q, vistoriadorId: vistJoao }));
      expect((await ger.post('/laudos', base({ placa: q, vistoriadorId: vistJoao, dataLaudo: '2026-03-03' }))).status).toBe(201);
      await adm.post(`/laudos/${a.body.id}/cancelar`, { motivo: 'Lançado por engano' });
      expect((await ger.post('/laudos', base({ placa: q, vistoriadorId: vistJoao }))).status).toBe(201);
    });
  });

  describe('vistoriador e loja', () => {
    it('usuário Vistoriador sem cadastro de vistoriador ligado não lança', async () => {
      const email = `vis2.${unico()}@teste.local`;
      const r = await adm.post('/usuarios', { nome: 'Sem Cadastro', email, perfil: 'VISTORIADOR', empresaIds: [A1()] });
      const token = new URL(r.body.conviteLink).searchParams.get('token')!;
      const c = cliente(app);
      await c.post('/auth/aceitar-convite', { token, senha: 'Minha-senha-nova-9' });
      await c.login(email, 'Minha-senha-nova-9');
      const l = await c.post('/laudos', base());
      expect(l.status).toBe(409); expect(l.body.mensagem).toMatch(/ligado a um cadastro de vistoriador/);
    });
    it('Gerente precisa escolher um vistoriador ativo que atue na loja', async () => {
      expect((await ger.post('/laudos', base())).status).toBe(422);
      const outraLoja = (await gerA2.post('/vistoriadores', { nome: 'Só da loja 2', empresaIds: [cen.A.empresaIds[1]] })).body.id;
      expect((await ger.post('/laudos', base({ vistoriadorId: outraLoja }))).status).toBe(422);
    });
    it('Financeiro não lança; o laudo fica na loja em que foi lançado', async () => {
      expect((await fin.post('/laudos', base())).status).toBe(403);
      const l = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      expect(l.empresaId).toBe(A1());
      expect((await gerA2.get(`/laudos/${l.id}`)).status).toBe(404);
      expect(((await gerA2.get('/laudos?limite=200')).body.itens as { id: string }[]).map((x) => x.id)).not.toContain(l.id);
      expect((await admB.get(`/laudos/${l.id}`)).status).toBe(404);
    });
  });

  describe('listagem e visibilidade', () => {
    it('o Vistoriador vê só os próprios laudos; o Gerente e o Financeiro veem os da loja', async () => {
      const dele = (await vis.post('/laudos', base())).body;
      const doJoao = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      const meus = ((await vis.get('/laudos?limite=200')).body.itens as { id: string; vistoriadorId: string }[]);
      expect(meus.map((l) => l.id)).toContain(dele.id); expect(meus.map((l) => l.id)).not.toContain(doJoao.id);
      expect(new Set(meus.map((l) => l.vistoriadorId))).toEqual(new Set([vistAna]));
      expect((await vis.get(`/laudos/${doJoao.id}`)).status).toBe(404);
      for (const c of [ger, fin, adm]) expect(((await c.get('/laudos?limite=200')).body.itens as { id: string }[]).map((l) => l.id)).toEqual(expect.arrayContaining([dele.id, doJoao.id]));
    });
    it('filtros: placa, período, cliente, vistoriador e situação; paginação por número', async () => {
      const p = placa();
      const l = (await ger.post('/laudos', base({ placa: p, vistoriadorId: vistJoao, dataLaudo: '2026-04-15' }))).body;
      const ids = async (q: string) => ((await ger.get(`/laudos?${q}`)).body.itens as { id: string }[]).map((x) => x.id);
      expect(await ids(`placa=${p.slice(0, 4)}`)).toContain(l.id);
      expect(await ids('de=2026-04-15&ate=2026-04-15')).toEqual([l.id]);
      expect(await ids(`clienteId=${semPrecoId}&de=2026-04-15&ate=2026-04-15`)).toEqual([]);
      expect(await ids(`vistoriadorId=${vistAna}&de=2026-04-15&ate=2026-04-15`)).toEqual([]);
      const pag = (await ger.get('/laudos?limite=2')).body;
      expect(pag.itens).toHaveLength(2); expect(pag.proximoAntesDoNumero).toBe(pag.itens[1].numero);
      const seg = (await ger.get(`/laudos?limite=2&antesDoNumero=${pag.proximoAntesDoNumero}`)).body;
      expect(seg.itens[0].numero).toBeLessThan(pag.itens[1].numero);
    });
  });

  describe('lote', () => {
    it('as linhas boas entram e as ruins voltam com o motivo, sem derrubar o lote', async () => {
      const dup = placa();
      await ger.post('/laudos', base({ placa: dup, vistoriadorId: vistJoao }));
      const itens = [
        { placa: placa(), clienteId, servicoId, formaPagamentoId: pix },
        { placa: 'ZZZ', clienteId, servicoId, formaPagamentoId: pix },
        { placa: placa(), clienteId: semPrecoId, servicoId: (await adm.post('/servicos', { nome: `Sem preço ${unico()}` })).body.id, formaPagamentoId: pix },
        { placa: dup, clienteId, servicoId, formaPagamentoId: pix },
        { placa: placa(), clienteId: semPreco2Id, servicoId, formaPagamentoId: faturado, valorManualCentavos: 9900 },
      ];
      const r = await vis.post('/laudos/lote', { itens });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ lancados: 2, erros: 3 });
      const por = (i: number) => r.body.resultados[i];
      expect(por(0).ok).toBe(true); expect(por(1).erro).toMatch(/placa/i);
      expect(por(2).erro).toMatch(/não tem preço/i); expect(por(3).codigo).toBe('DUPLICADO'); expect(por(4).laudo).toMatchObject({ precoManual: true, valorCobradoCentavos: 9900 });
      expect(new Set(r.body.resultados.filter((x: { ok: boolean }) => x.ok).map((x: { laudo: { id: string } }) => x.laudo.id)).size).toBe(2);
    });
    it('duplicidade dentro do próprio lote é pega, e o limite é de 50 linhas', async () => {
      const p = placa();
      const r = await vis.post('/laudos/lote', { itens: [{ placa: p, clienteId, servicoId, formaPagamentoId: pix }, { placa: p, clienteId, servicoId, formaPagamentoId: pix }] });
      expect(r.body).toMatchObject({ lancados: 1, erros: 1 });
      expect((await vis.post('/laudos/lote', { itens: [] })).status).toBe(422);
      expect((await vis.post('/laudos/lote', { itens: Array.from({ length: 51 }, () => ({})) })).status).toBe(422);
    });
  });

  describe('edição', () => {
    it('o Vistoriador corrige o próprio laudo do dia (placa, forma, observação), mas não o valor', async () => {
      const l = (await vis.post('/laudos', base())).body;
      const nova = placa();
      const r = await vis.patch(`/laudos/${l.id}`, { placa: nova, formaPagamentoId: pix, observacao: 'Corrigido' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ placa: nova, formaPagamentoId: pix, observacao: 'Corrigido' });
      expect((await vis.patch(`/laudos/${l.id}`, { valorCobradoCentavos: 100 })).status).toBe(403);
      expect((await vis.patch(`/laudos/${l.id}`, { dataLaudo: '2026-01-02' })).status).toBe(403);
    });
    it('o Vistoriador não edita laudo de outro nem de outro dia; o Financeiro não edita', async () => {
      const doJoao = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      expect((await vis.patch(`/laudos/${doJoao.id}`, { observacao: 'x' })).status).toBe(404);
      const antigo = (await ger.post('/laudos', base({ vistoriadorId: vistJoao, dataLaudo: '2026-05-05' }))).body;
      expect((await fin.patch(`/laudos/${antigo.id}`, { observacao: 'x' })).status).toBe(403);
    });
    it('trocar cliente ou serviço recalcula o preço e os custos gravados', async () => {
      const l = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      expect((await ger.get(`/laudos/${l.id}`)).body).toMatchObject({ valorCobradoCentavos: 18000, custosCentavos: 4700 });
      const r = await ger.patch(`/laudos/${l.id}`, { clienteId: semPreco2Id, valorManualCentavos: 10000 });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ precoManual: true, valorCobradoCentavos: 10000, custosCentavos: 3800 + 500 });
      const custosAtivos = (await ger.get(`/laudos/${l.id}`)).body.custos as unknown[];
      expect(custosAtivos).toHaveLength(2);
      const ativos = await db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('SELECT count(*) FILTER (WHERE ativo) AS a, count(*) AS t FROM laudo_custo WHERE laudo_id = $1', [l.id]));
      expect(Number(ativos.rows[0].a)).toBe(2); expect(Number(ativos.rows[0].t)).toBe(4); // os antigos ficam guardados, inativos
    });
    it('laudo faturado ou baixado (travado) não muda; o banco também impede', async () => {
      const l = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await db.tenant(ctx, (c) => c.query('UPDATE laudo SET travado_em = now() WHERE id = $1', [l.id]));
      const r = await ger.patch(`/laudos/${l.id}`, { observacao: 'x' });
      expect(r.status).toBe(409); expect(r.body.mensagem).toMatch(/fatura|baixa/i);
      await expect(db.tenant(ctx, (c) => c.query('UPDATE laudo SET valor_cobrado_centavos = 1 WHERE id = $1', [l.id]))).rejects.toThrow(/já faturado ou baixado/);
      expect((await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Tentando cancelar travado' })).status).toBe(409);
    });
  });

  describe('cancelamento', () => {
    it('o Vistoriador solicita; o Gerente ou o Administrativo autoriza; quem pediu não autoriza o próprio pedido', async () => {
      const l = (await vis.post('/laudos', base())).body;
      expect((await vis.post(`/laudos/${l.id}/cancelar`, { motivo: 'Quero cancelar' })).status).toBe(403);
      const p = await vis.post(`/laudos/${l.id}/solicitar-cancelamento`, { motivo: 'Lancei no cliente errado' });
      expect(p.status).toBe(201); expect(p.body.cancelamentoPedidoEm).toBeTruthy();
      expect((await vis.post(`/laudos/${l.id}/solicitar-cancelamento`, { motivo: 'De novo' })).status).toBe(409);
      expect(((await ger.get('/laudos?cancelamentoPedido=1')).body.itens as { id: string }[]).map((x) => x.id)).toContain(l.id);
      const c = await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Confirmado com o vistoriador' });
      expect(c.status).toBe(201); expect(c.body.status).toBe('CANCELADO');
      expect((await ger.patch(`/laudos/${l.id}`, { observacao: 'x' })).status).toBe(409);
    });
    it('o Gerente que pediu o cancelamento não o autoriza; o Administrativo sim', async () => {
      const l = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      await ger.post(`/laudos/${l.id}/solicitar-cancelamento`, { motivo: 'Cliente desistiu' });
      const proprio = await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Eu mesmo autorizo' });
      expect(proprio.status).toBe(403); expect(proprio.body.mensagem).toMatch(/quem pediu/i);
      expect((await adm.post(`/laudos/${l.id}/cancelar`, { motivo: 'Autorizado pela rede' })).status).toBe(201);
    });
    it('o Gerente pode rejeitar o pedido e o laudo segue ativo; o motivo é obrigatório', async () => {
      const l = (await vis.post('/laudos', base())).body;
      await vis.post(`/laudos/${l.id}/solicitar-cancelamento`, { motivo: 'Acho que errei' });
      expect((await ger.post(`/laudos/${l.id}/rejeitar-cancelamento`, { motivo: 'ok' })).status).toBe(422);
      const r = await ger.post(`/laudos/${l.id}/rejeitar-cancelamento`, { motivo: 'O laudo está certo, confirmei' });
      expect(r.body.cancelamentoPedidoEm).toBeNull(); expect(r.body.status).toBe('ATIVO');
      expect((await ger.post(`/laudos/${l.id}/rejeitar-cancelamento`, { motivo: 'Sem pedido pendente' })).status).toBe(409);
    });
    it('o Vistoriador não pede cancelamento de laudo de outro; Financeiro não cancela', async () => {
      const doJoao = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      expect((await vis.post(`/laudos/${doJoao.id}/solicitar-cancelamento`, { motivo: 'Não é meu' })).status).toBe(404);
      expect((await fin.post(`/laudos/${doJoao.id}/cancelar`, { motivo: 'Financeiro cancelando' })).status).toBe(403);
    });
    it('laudo cancelado fica guardado e imutável no banco', async () => {
      const l = (await ger.post('/laudos', base({ vistoriadorId: vistJoao }))).body;
      await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Teste de imutabilidade' });
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await expect(db.tenant(ctx, (c) => c.query(`UPDATE laudo SET observacao = 'x' WHERE id = $1`, [l.id]))).rejects.toThrow(/cancelado/);
      expect(((await ger.get('/laudos?status=CANCELADO&limite=200')).body.itens as { id: string }[]).map((x) => x.id)).toContain(l.id);
    });
  });

  describe('auditoria e isolamento no banco', () => {
    it('lançamento, edição e cancelamento ficam no log com quem fez e o motivo', async () => {
      const l = (await vis.post('/laudos', base())).body;
      await vis.patch(`/laudos/${l.id}`, { observacao: 'Ajuste' });
      await vis.post(`/laudos/${l.id}/solicitar-cancelamento`, { motivo: 'Lançado errado' });
      await ger.post(`/laudos/${l.id}/cancelar`, { motivo: 'Confirmado' });
      const log = (await adm.get(`/auditoria?entidade=laudo&entidadeId=${l.id}&limite=20`)).body.itens as { acao: string; usuario: string; motivo: string | null }[];
      expect(log.map((e) => e.acao)).toEqual(expect.arrayContaining(['laudo.lancado', 'laudo.editado', 'laudo.cancelamento_solicitado', 'laudo.cancelado']));
      expect(log.find((e) => e.acao === 'laudo.lancado')!.usuario).toBe('Vistoriador A1');
      expect(log.find((e) => e.acao === 'laudo.cancelado')!.motivo).toBe('Confirmado');
    });
    it('o banco impede ler laudo de outro grupo ou de outra loja, mesmo sem filtro', async () => {
      const [a1, a2] = cen.A.empresaIds;
      const todos = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, t = 'laudo') => (await db.tenant(ctx, (c) => c.query(`SELECT DISTINCT empresa_id FROM ${t}`))).rows.map((r) => r.empresa_id);
      expect(await todos({ grupoId: cen.A.grupoId, rede: true, empresas: [] })).toEqual([a1]);
      expect(await todos({ grupoId: cen.A.grupoId, rede: false, empresas: [a2!] })).toEqual([]);
      expect(await todos({ grupoId: cen.B.grupoId, rede: true, empresas: [] })).toEqual([]);
      expect(await todos({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, 'laudo_custo')).toEqual([a1]);
      expect(await todos({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, 'laudo_custo')).toEqual([]);
      expect(Number((await db.semTenant((c) => c.query('SELECT count(*) AS n FROM laudo'))).rows[0].n)).toBe(0);
      await expect(db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('DELETE FROM laudo'))).rejects.toMatchObject({ code: '42501' });
    });
    it('o banco recusa laudo com preço manual incoerente', async () => {
      await expect(db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query(
        `INSERT INTO laudo (grupo_id, empresa_id, placa, data_laudo, cliente_id, servico_id, vistoriador_id, forma_pagamento_id, preco_tabela_centavos, preco_manual, valor_cobrado_centavos, criado_por)
         VALUES ($1,$2,'ABC1D23','2026-01-01',$3,$4,$5,$6,18000,true,18000,$7)`, [cen.A.grupoId, A1(), clienteId, servicoId, vistAna, faturado, cen.A.usuarioIds[0]]))).rejects.toMatchObject({ code: '23514' });
      expect(SENHA).toBeTruthy();
    });
  });
});
