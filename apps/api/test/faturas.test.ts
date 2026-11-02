import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { crc16 } from '@ecv/shared';
import type { DbService } from '../src/db/db.service';
import { SENHA, cliente, criarCenario, gerarCnpj, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 9000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('faturados', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C, admB: C;
  let servicoId: string, faturado: string, pix: string, vist: string, caixa: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const novoCliente = async (extra: object = {}) => {
    const id = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}`, ...extra })).body.id as string;
    await adm.post(`/clientes/${id}/precos`, { servicoId, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    return id;
  };
  const lancar = async (clienteId: string, extra: object = {}) => {
    const r = await ger.post('/laudos', { placa: placa(), clienteId, servicoId, formaPagamentoId: faturado, vistoriadorId: vist, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string };
  };
  const gerar = async (clienteIds: string[], extra: object = {}) => {
    const r = await ger.post('/faturas', { periodoIni: diasAtras(60), periodoFim: hoje(), clienteIds, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { geradas: number; erros: number; resultados: { ok: boolean; fatura?: { id: string; numero: number; totalCentavos: number; vencimento: string; titulos: number }; erro?: string }[] };
  };
  const saldoConta = async (id: string) => ((await ger.get('/caixa/contas')).body.contas as { id: string; saldoCentavos: number }[]).find((c) => c.id === id)!.saldoCentavos;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2', 'adminB'].map(entrar))) as [C, C, C, C, C, C];
    servicoId = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    const formas = (await adm.get('/formas-pagamento')).body as { id: string; nome: string }[];
    faturado = formas.find((f) => f.nome === 'Faturado')!.id; pix = formas.find((f) => f.nome === 'PIX')!.id;
    vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()], usuarioId: cen.A.usuarioIds[3] })).body.id;
    caixa = (await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  });
  afterAll(() => app.close());

  describe('gerar', () => {
    it('a prévia lista só clientes com títulos faturáveis em aberto no período (à vista fica de fora)', async () => {
      const c1 = await novoCliente(); const c2 = await novoCliente();
      await lancar(c1); await lancar(c1); await lancar(c2, { formaPagamentoId: pix });
      const r = (await ger.get(`/faturas/previa?periodoIni=${diasAtras(30)}&periodoFim=${hoje()}`)).body;
      const l1 = r.clientes.find((c: { clienteId: string }) => c.clienteId === c1);
      expect(l1).toMatchObject({ titulos: 2, totalCentavos: 36000 });
      expect(r.clientes.find((c: { clienteId: string }) => c.clienteId === c2)).toBeUndefined();
    });
    it('gera uma fatura por cliente: vencimento = emissão + prazo, títulos presos, laudos travados', async () => {
      const c1 = await novoCliente({ prazoDias: 15 }); const l1 = await lancar(c1); await lancar(c1); await lancar(c1);
      const r = await gerar([c1]);
      expect(r).toMatchObject({ geradas: 1, erros: 0 });
      const f = r.resultados[0]!.fatura!;
      expect(f).toMatchObject({ titulos: 3, totalCentavos: 54000 });
      expect(f.vencimento).toBe(new Date(Date.parse(hoje()) + 15 * 86_400_000).toISOString().slice(0, 10));
      expect((await ger.get(`/laudos/${l1.id}`)).body.travado).toBe(true);
      expect((await ger.patch(`/laudos/${l1.id}`, { valorCobradoCentavos: 100, ajusteMotivo: 'Tentativa' })).status).toBe(409);
      const det = (await ger.get(`/faturas/${f.id}`)).body;
      expect(det).toMatchObject({ status: 'ABERTA', totalCentavos: 54000, saldoCentavos: 54000, encargosCentavos: 0, recebidoCentavos: 0 });
      expect(det.titulos).toHaveLength(3);
      // de novo no mesmo período: nada sobrou para faturar
      const de = await ger.post('/faturas', { periodoIni: diasAtras(60), periodoFim: hoje(), clienteIds: [c1] });
      expect(de.body).toMatchObject({ geradas: 0, erros: 1 });
    });
    it('o que entra depois do período vira outra fatura (complementar); cliente sem título volta com o motivo', async () => {
      const c1 = await novoCliente(); await lancar(c1, { dataLaudo: diasAtras(10) });
      const vazio = await novoCliente();
      const r = await gerar([c1, vazio], { periodoFim: diasAtras(5) });
      expect(r).toMatchObject({ geradas: 1, erros: 1 });
      expect(r.resultados.find((x) => !x.ok)!.erro).toMatch(/não há títulos faturáveis/);
    });
    it('não gera para período que não terminou nem sem permissão (Vistoriador)', async () => {
      const c1 = await novoCliente(); await lancar(c1);
      expect((await ger.post('/faturas', { periodoIni: diasAtras(5), periodoFim: '2999-01-01', clienteIds: [c1] })).status).toBe(422);
      expect((await vis.post('/faturas', { periodoIni: diasAtras(5), periodoFim: hoje(), clienteIds: [c1] })).status).toBe(403);
      expect((await fin.get(`/faturas/previa?periodoIni=${diasAtras(5)}&periodoFim=${hoje()}`)).status).toBe(200); // Financeiro gera fatura
    });
  });

  describe('baixa', () => {
    it('total, em dia: quita a fatura inteira e o dinheiro entra na conta', async () => {
      const c1 = await novoCliente(); await lancar(c1); await lancar(c1);
      const f = (await gerar([c1])).resultados[0]!.fatura!;
      const antes = await saldoConta(caixa);
      const r = await fin.post(`/faturas/${f.id}/baixas`, { contaId: caixa });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ recebidoCentavos: 36000, titulosBaixados: 2, status: 'PAGA' });
      expect(await saldoConta(caixa)).toBe(antes + 36000);
      expect((await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa })).status).toBe(409);
    });
    it('parcial: o valor é distribuído nos títulos em ordem; a segunda baixa quita', async () => {
      const c1 = await novoCliente(); await lancar(c1, { dataLaudo: diasAtras(3) }); await lancar(c1, { dataLaudo: diasAtras(2) }); await lancar(c1, { dataLaudo: diasAtras(1) });
      const f = (await gerar([c1])).resultados[0]!.fatura!;
      const r1 = await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa, principalCentavos: 25000 });
      expect(r1.body).toMatchObject({ recebidoCentavos: 25000, titulosBaixados: 2, status: 'PARCIAL' });
      const det = (await ger.get(`/faturas/${f.id}`)).body;
      expect(det.titulos.map((t: { saldoCentavos: number }) => t.saldoCentavos)).toEqual([0, 11000, 18000]);
      expect((await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa, principalCentavos: 29001 })).status).toBe(422);
      expect((await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa })).body).toMatchObject({ recebidoCentavos: 29000, status: 'PAGA' });
    });
    it('vencida: multa 2% e juros 1% ao mês pro rata, por título, desde o vencimento da fatura', async () => {
      const c1 = await novoCliente(); await lancar(c1, { dataLaudo: diasAtras(45) }); await lancar(c1, { dataLaudo: diasAtras(44) });
      const f = (await gerar([c1], { periodoIni: diasAtras(60), periodoFim: diasAtras(40), emissao: diasAtras(40) })).resultados[0]!.fatura!;
      expect(f.vencimento).toBe(diasAtras(30)); // emissão + 10 dias
      const det = (await ger.get(`/faturas/${f.id}`)).body;
      expect(det).toMatchObject({ vencida: true, diasAtraso: 30, encargosCentavos: 2 * (360 + 180), totalHojeCentavos: 36000 + 1080 });
      const r = await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa });
      expect(r.body).toMatchObject({ recebidoCentavos: 37080, status: 'PAGA' });
    });
    it('estornar uma baixa da fatura reabre a fatura', async () => {
      const c1 = await novoCliente(); await lancar(c1);
      const f = (await gerar([c1])).resultados[0]!.fatura!;
      await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa });
      const t = (await ger.get(`/faturas/${f.id}`)).body.titulos[0];
      const baixa = (await ger.get(`/receber/titulos/${t.id}`)).body.baixas[0];
      expect((await ger.post(`/receber/baixas/${baixa.id}/estornar`, { motivo: 'Cliente pediu o estorno' })).status).toBe(201);
      expect((await ger.get(`/faturas/${f.id}`)).body).toMatchObject({ status: 'ABERTA', saldoCentavos: 18000 });
    });
  });

  describe('cancelar e referências', () => {
    it('cancela fatura sem baixa: liberta os títulos, destrava os laudos e devolve o vencimento original', async () => {
      const c1 = await novoCliente(); const l = await lancar(c1);
      const f = (await gerar([c1], { vencimento: hoje() })).resultados[0]!.fatura!;
      expect((await fin.post(`/faturas/${f.id}/cancelar`, { motivo: 'Fatura gerada por engano' })).status).toBe(403);
      expect((await ger.post(`/faturas/${f.id}/cancelar`, { motivo: 'abc' })).status).toBe(422);
      expect((await ger.post(`/faturas/${f.id}/cancelar`, { motivo: 'Fatura gerada por engano' })).status).toBe(201);
      expect((await ger.get(`/laudos/${l.id}`)).body.travado).toBe(false);
      const t = ((await ger.get('/receber/titulos?situacao=abertos&limite=500')).body.itens as { laudoId: string; vencimento: string; faturaId: string | null }[]).find((x) => x.laudoId === l.id)!;
      expect(t.faturaId).toBeNull();
      expect(t.vencimento).toBe(new Date(Date.parse(hoje()) + 10 * 86_400_000).toISOString().slice(0, 10));
      expect((await ger.get(`/faturas/${f.id}`)).body.status).toBe('CANCELADA');
      expect((await ger.post(`/faturas/${f.id}/cancelar`, { motivo: 'Cancelando de novo' })).status).toBe(409);
      expect((await gerar([c1])).geradas).toBe(1); // os mesmos laudos podem ser faturados de novo
    });
    it('não cancela fatura que já recebeu baixa', async () => {
      const c1 = await novoCliente(); await lancar(c1);
      const f = (await gerar([c1])).resultados[0]!.fatura!;
      await ger.post(`/faturas/${f.id}/baixas`, { contaId: caixa, principalCentavos: 5000 });
      const r = await ger.post(`/faturas/${f.id}/cancelar`, { motivo: 'Quero cancelar mesmo assim' });
      expect(r.status).toBe(409); expect(r.body.mensagem).toMatch(/Estorne as baixas/);
    });
    it('guarda número da NF e do boleto só como referência; valor da fatura não muda nem direto no banco', async () => {
      const c1 = await novoCliente(); await lancar(c1);
      const f = (await gerar([c1])).resultados[0]!.fatura!;
      const e = await ger.patch(`/faturas/${f.id}`, { numeroNf: '12345', numeroBoleto: '0001.2345' });
      expect(e.status).toBe(200); expect(e.body).toMatchObject({ numeroNf: '12345', numeroBoleto: '0001.2345' });
      await expect(db.tenant({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, (c) => c.query('UPDATE fatura SET total_centavos = 1 WHERE id = $1', [f.id]))).rejects.toThrow();
    });
    it('lista com filtro de cliente, situação e datas', async () => {
      const c1 = await novoCliente(); await lancar(c1);
      const f = (await gerar([c1])).resultados[0]!.fatura!;
      const so = (await ger.get(`/faturas?situacao=todas&clienteId=${c1}`)).body;
      expect(so.itens.map((i: { id: string }) => i.id)).toEqual([f.id]);
      expect((await ger.get(`/faturas?situacao=pagas&clienteId=${c1}`)).body.itens).toHaveLength(0);
      expect((await ger.get(`/faturas?situacao=abertas&clienteId=${c1}&de=${hoje()}&ate=${hoje()}`)).body.itens).toHaveLength(1);
      expect((await ger.get(`/faturas?situacao=abertas&clienteId=${c1}&de=${diasAtras(10)}&ate=${diasAtras(5)}`)).body.itens).toHaveLength(0);
    });
  });

  describe('Como pagar: PIX e PDF', () => {
    let faturaId: string;
    beforeAll(async () => {
      const c1 = await novoCliente(); await lancar(c1); await lancar(c1);
      faturaId = (await gerar([c1])).resultados[0]!.fatura!.id;
    });
    it('sem conta marcada para a fatura não há PIX; o PDF sai mesmo assim', async () => {
      const p = (await ger.get(`/faturas/${faturaId}/pix`)).body;
      expect(p).toMatchObject({ disponivel: false, valorCentavos: 36000 });
      const r = await ger.get(`/faturas/${faturaId}/pdf`).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
      expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/application\/pdf/);
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });
    it('com a conta aprovada para a fatura, devolve o copia e cola com o valor do dia e o QR Code', async () => {
      const cnpj = gerarCnpj();
      const c = await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco da fatura', tipo: 'BANCO', saldoInicialCentavos: 0, banco: 'Banco Exemplo', agencia: '1234', conta: '56789-0', tipoConta: 'CORRENTE', titular: 'Vistoria Centro Ltda', documentoTitular: cnpj, pixTipo: 'CNPJ', pixChave: cnpj, exibirNaFatura: true, senha: SENHA });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const p = (await ger.get(`/faturas/${faturaId}/pix`)).body;
      expect(p).toMatchObject({ disponivel: true, valorCentavos: 36000, titular: 'Vistoria Centro Ltda' });
      expect(p.copiaECola).toContain('5406360.00');
      expect(p.copiaECola.slice(-4)).toBe(crc16(p.copiaECola.slice(0, -4)));
      expect(p.copiaECola).toContain(`0114${cnpj}`);
      expect(p.qrCode).toMatch(/^data:image\/png;base64,/);
      const r = await ger.get(`/faturas/${faturaId}/pdf`).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
      expect(r.status).toBe(200); expect((r.body as Buffer).length).toBeGreaterThan(3000);
    });
    it('o Vistoriador não vê a fatura; outra loja e outro grupo também não', async () => {
      expect((await vis.get(`/faturas/${faturaId}`)).status).toBe(403);
      expect((await vis.get(`/faturas/${faturaId}/pdf`)).status).toBe(403);
      expect((await gerA2.get(`/faturas/${faturaId}`)).status).toBe(404);
      expect((await admB.get(`/faturas/${faturaId}/pdf`)).status).toBe(404);
    });
  });

  it('direto no banco, outro grupo e outra loja não leem faturas', async () => {
    const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }) => (await db.tenant(ctx, (c) => c.query('SELECT 1 FROM fatura WHERE empresa_id = $1', [A1()]))).rowCount;
    expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] })).toBeGreaterThan(0);
    expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] })).toBe(0);
    expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] })).toBe(0);
  });
  it('as ações ficam no log', async () => {
    const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
    expect(acoes).toEqual(expect.arrayContaining(['fatura.gerada', 'fatura.baixa', 'fatura.cancelada', 'fatura.referencias_alteradas']));
  });
});
