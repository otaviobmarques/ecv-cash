import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const mesAnterior = () => { const [a, m] = hoje().split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(a, m - 2, 1)); return d.toISOString().slice(0, 7); };
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 61000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('royalties e alíquotas', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C;
  let servico: string, cli: string, pix: string, vist: string, banco: string, franqueador: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const MES = mesAnterior();
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const regra = (extra: object) => adm.post('/repasses/regras', { fornecedorId: franqueador, nome: 'Royalties', vigenciaIni: '2025-01-01', ...extra });
  const desativarRegras = async () => { for (const r of (await adm.get('/repasses/regras')).body as { id: string; ativa: boolean }[]) if (r.ativa) await adm.patch(`/repasses/regras/${r.id}`, { ativa: false }); };
  const previa = async (nome?: string) => ((await adm.get(`/repasses/previa?mes=${MES}`)).body as { nome: string; baseCentavos: number; valorCentavos: number; apurada: boolean }[]).find((x) => !nome || x.nome === nome)!;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2'].map(entrar))) as [C, C, C, C, C];
    servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    await adm.post(`/servicos/${servico}/custos`, { descricao: 'Taxa', tipo: 'VALOR', valorCentavos: 4000 });
    cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}` })).body.id;
    await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    pix = ((await adm.get('/formas-pagamento')).body as { id: string; nome: string }[]).find((f) => f.nome === 'PIX')!.id;
    vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()] })).body.id;
    banco = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
    franqueador = (await adm.post('/fornecedores', { nome: `Franqueadora ${unico()}`, tipo: 'FRANQUEADOR' })).body.id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: pix, vistoriadorId: vist, dataLaudo: `${MES}-10` })).body.id);
    const titulos = (await ger.get('/receber/titulos?situacao=todos&limite=500')).body.itens as { id: string; laudoId: string }[];
    for (const id of ids.slice(0, 2)) expect((await ger.post(`/receber/titulos/${titulos.find((t) => t.laudoId === id)!.id}/baixas`, { contaId: banco, data: `${MES}-15` })).status).toBe(201);
  });
  afterAll(() => app.close());

  describe('alíquotas', () => {
    it('só o Administrativo cadastra; Gerente e Financeiro veem; Vistoriador, não', async () => {
      const corpo = { nome: 'ISS', percentualBp: 200, vigenciaIni: '2025-01-01' };
      expect((await ger.post('/aliquotas', corpo)).status).toBe(403);
      expect((await adm.post('/aliquotas', { nome: 'OUTRO', percentualBp: 100, vigenciaIni: '2025-01-01' })).status).toBe(422);
      const r = await adm.post('/aliquotas', corpo);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((await ger.get('/aliquotas')).body).toHaveLength(1); expect((await fin.get('/aliquotas')).status).toBe(200); expect((await vis.get('/aliquotas')).status).toBe(403);
    });
    it('não se sobrepõem; reajuste = encerrar na véspera e abrir outra; o percentual nunca muda', async () => {
      expect((await adm.post('/aliquotas', { nome: 'ISS', percentualBp: 300, vigenciaIni: '2026-01-01' })).status).toBe(409);
      const atual = ((await adm.get('/aliquotas')).body as { id: string }[])[0]!;
      expect((await adm.patch(`/aliquotas/${atual.id}`, { vigenciaFim: '2099-12-31' })).status).toBe(200);
      await expect(db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('UPDATE aliquota_imposto SET percentual_bp = 999'))).rejects.toThrow();
      expect((await adm.post('/aliquotas', { nome: 'PIS', percentualBp: 65, vigenciaIni: '2025-01-01' })).status).toBe(201); // outro imposto convive
    });
  });

  describe('regras e apuração', () => {
    it('só o Administrativo cria regra e apura; Gerente e Financeiro consultam', async () => {
      expect((await ger.post('/repasses/regras', { fornecedorId: franqueador, nome: 'x1', tipo: 'VALOR_FIXO', valorCentavos: 100, vigenciaIni: '2025-01-01' })).status).toBe(403);
      expect((await ger.get('/repasses/regras')).status).toBe(200); expect((await fin.get('/repasses/regras')).status).toBe(200);
      expect((await ger.post('/repasses/apurar', { mes: MES })).status).toBe(403);
      expect((await regra({ tipo: 'PERCENTUAL', percentualBp: 500 })).status).toBe(422); // sem base
      expect((await regra({ tipo: 'VALOR_FIXO' })).status).toBe(422);
    });
    it('percentual sobre o bruto, sobre o líquido (menos custos e impostos) e sobre o recebido', async () => {
      await desativarRegras();
      await regra({ nome: 'Bruto', tipo: 'PERCENTUAL', percentualBp: 500, base: 'BRUTO' });
      await regra({ nome: 'Líquido', tipo: 'PERCENTUAL', percentualBp: 500, base: 'LIQUIDO' });
      await regra({ nome: 'Recebido', tipo: 'PERCENTUAL', percentualBp: 500, base: 'RECEBIDO' });
      await regra({ nome: 'Fixo', tipo: 'VALOR_FIXO', valorCentavos: 100000 });
      expect(await previa('Bruto')).toMatchObject({ baseCentavos: 54000, valorCentavos: 2700 });
      // líquido: 54.000 - custos 12.000 - ISS 2% (1.080) - PIS 0,65% (351) = 40.569; 5% = 2.028
      expect(await previa('Líquido')).toMatchObject({ baseCentavos: 40569, valorCentavos: 2028 });
      expect(await previa('Recebido')).toMatchObject({ baseCentavos: 36000, valorCentavos: 1800 });
      expect(await previa('Fixo')).toMatchObject({ valorCentavos: 100000 });
    });
    it('mês que não terminou não se apura', async () => {
      const r = await adm.post('/repasses/apurar', { mes: hoje().slice(0, 7) });
      expect(r.status).toBe(422);
    });
    it('apurar cria uma conta a pagar por regra (royalty, aguardando aprovação), uma vez só', async () => {
      const r = await adm.post('/repasses/apurar', { mes: MES });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.apuradas).toBe(4);
      const bruto = r.body.criados.find((x: { nome: string }) => x.nome === 'Bruto');
      const t = (await adm.get(`/pagar/titulos/${bruto.tituloId}`)).body;
      expect(t).toMatchObject({ origem: 'ROYALTY', valorCentavos: 2700, status: 'PENDENTE', competencia: MES });
      expect(t.vencimento).toMatch(/^\d{4}-\d{2}-10$/);
      const de_novo = await adm.post('/repasses/apurar', { mes: MES });
      expect(de_novo.body.apuradas).toBe(0); expect(de_novo.body.pulados).toHaveLength(4);
      expect(await previa('Bruto')).toMatchObject({ apurada: true });
    });
    it('cancelar a apuração cancela a conta e permite apurar de novo; paga, não cancela', async () => {
      const ap = ((await adm.get('/repasses/apuracoes')).body as { id: string; nome: string; tituloPagarId: string }[]);
      const bruto = ap.find((x) => x.nome === 'Bruto')!;
      expect((await adm.post(`/repasses/apuracoes/${bruto.id}/cancelar`, { motivo: 'Base estava errada' })).status).toBe(201);
      expect((await adm.get(`/pagar/titulos/${bruto.tituloPagarId}`)).body.status).toBe('CANCELADO');
      expect((await adm.post('/repasses/apurar', { mes: MES })).body.apuradas).toBe(1);
      const fixo = ap.find((x) => x.nome === 'Fixo')!;
      await ger.post(`/pagar/titulos/${fixo.tituloPagarId}/aprovar`);
      expect((await ger.post(`/pagar/titulos/${fixo.tituloPagarId}/pagamentos`, { contaId: banco, principalCentavos: 100 })).status).toBe(201);
      expect((await adm.post(`/repasses/apuracoes/${fixo.id}/cancelar`, { motivo: 'Quero cancelar' })).status).toBe(409);
    });
    it('regra que vale só parte do mês considera só esses dias; fora da vigência não apura', async () => {
      await desativarRegras();
      await regra({ nome: 'Parcial', tipo: 'PERCENTUAL', percentualBp: 1000, base: 'BRUTO', vigenciaIni: `${MES}-11` }); // os laudos são do dia 10
      expect(await previa('Parcial')).toMatchObject({ baseCentavos: 0, valorCentavos: 0 });
      const r = await adm.post('/repasses/apurar', { mes: MES });
      expect(r.body.pulados[0]).toMatchObject({ nome: 'Parcial' });
    });
  });

  describe('isolamento e auditoria', () => {
    it('outra loja e outro grupo não enxergam regras, apurações nem alíquotas', async () => {
      expect((await gerA2.get('/repasses/regras')).body).toEqual([]); expect((await gerA2.get('/aliquotas')).body).toEqual([]);
      const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, t: string) => (await db.tenant(ctx, (c) => c.query(`SELECT 1 FROM ${t}`))).rowCount;
      for (const t of ['regra_repasse', 'repasse_apuracao', 'aliquota_imposto']) {
        expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, t), t).toBeGreaterThan(0);
        expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, t), t).toBe(0);
        expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] }, t), t).toBe(0);
      }
    });
    it('as ações ficam no log', async () => {
      const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
      expect(acoes).toEqual(expect.arrayContaining(['aliquota.criada', 'aliquota.alterada', 'repasse.regra_criada', 'repasse.regra_alterada', 'repasse.apurado', 'repasse.apuracao_cancelada']));
    });
  });
});
