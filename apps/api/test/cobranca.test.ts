import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { CobrancaService } from '../src/cobranca/cobranca.service';
import { MailerFalso, SENHA, cliente, criarCenario, gerarCnpj, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dias = (n: number) => new Date(Date.parse(hoje()) + n * 86_400_000).toISOString().slice(0, 10);
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ';
let seq = 81000;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };

describe('cobrança por e-mail', () => {
  const caixa = new MailerFalso();
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, gerA2: C;
  let servico: string, faturado: string, vist: string;
  const A1 = () => cen.A.empresaIds[0]!;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const novaFatura = async (vencimento: string, emissao: string, extra: object = {}) => {
    const cli = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Cliente ${unico()}`, emailsCobranca: [`financeiro.${unico()}@cliente.test`], ...extra })).body.id as string;
    await adm.post(`/clientes/${cli}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2025-01-01' });
    await ger.post('/laudos', { placa: placa(), clienteId: cli, servicoId: servico, formaPagamentoId: faturado, vistoriadorId: vist, dataLaudo: emissao });
    const r = await ger.post('/faturas', { periodoIni: emissao, periodoFim: emissao, clienteIds: [cli], emissao, vencimento });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { clienteId: cli, faturaId: r.body.resultados[0].fatura.id as string, numero: r.body.resultados[0].fatura.numero as number };
  };
  const processar = async () => (await ger.post('/cobranca/processar')).body as { avaliadas: number; enviados: number; ativa: boolean; semConfiguracao: number; semDestinatario: number; erros: number };
  const envios = async (faturaId: string) => (await ger.get(`/cobranca/envios?faturaId=${faturaId}`)).body as { tipo: string; dias: number; status: string; para: string[]; assunto: string; automatico: boolean; erro: string | null }[];

  beforeAll(async () => {
    ({ app, db } = await subirApp({ mailer: caixa }));
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'gerenteA2'].map(entrar))) as [C, C, C, C, C];
    servico = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    faturado = ((await adm.get('/formas-pagamento')).body as { id: string; nome: string }[]).find((f) => f.nome === 'Faturado')!.id;
    vist = (await adm.post('/vistoriadores', { nome: 'Ana', empresaIds: [A1()] })).body.id;
    const doc = gerarCnpj();
    await adm.post('/contas-financeiras', { empresaId: A1(), nome: 'Banco', tipo: 'BANCO', saldoInicialCentavos: 0, banco: 'Banco Exemplo', agencia: '1234', conta: '5678-9', tipoConta: 'CORRENTE', titular: 'Vistoria Centro Ltda', documentoTitular: doc, pixTipo: 'CNPJ', pixChave: doc, exibirNaFatura: true, senha: SENHA });
  });
  afterAll(() => app.close());

  describe('régua', () => {
    it('vem desligada: nada sai até a loja decidir', async () => {
      const f = await novaFatura(dias(3), hoje());
      const r = await processar();
      expect(r).toMatchObject({ ativa: false, enviados: 0 });
      expect(caixa.enviados).toHaveLength(0); expect(await envios(f.faturaId)).toEqual([]);
    });
    it('Gerente liga e ajusta; Financeiro só vê; Vistoriador, nada', async () => {
      expect((await fin.put('/cobranca/regua', { ativa: true })).status).toBe(403);
      expect((await fin.get('/cobranca/regua')).status).toBe(200); expect((await vis.get('/cobranca/regua')).status).toBe(403);
      expect((await ger.put('/cobranca/regua', { diasAntes: [1, 2, 3, 4, 5, 6] })).status).toBe(422);
      expect((await ger.put('/cobranca/regua', { copiaPara: 'isso-nao-e-email' })).status).toBe(422);
      const r = await ger.put('/cobranca/regua', { ativa: true, enviarAoGerar: false, diasAntes: [3, 1], diasApos: [1, 7], copiaPara: 'financeiro@loja.test' });
      expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body).toMatchObject({ ativa: true, diasAntes: [1, 3], diasApos: [1, 7], smtpConfigurado: true });
    });
  });

  describe('envio automático', () => {
    it('lembrete 3 dias antes: e-mail com a fatura em PDF, valor, PIX copia e cola e cópia para a loja', async () => {
      caixa.enviados.length = 0;
      const f = await novaFatura(dias(3), hoje());
      const r = await processar();
      expect(r.enviados).toBeGreaterThanOrEqual(1);
      const m = caixa.enviados.find((x) => x.assunto.includes(`nº ${f.numero}`))!;
      expect(m.assunto).toMatch(/^Lembrete: a fatura nº \d+ vence em/);
      expect(m.para).toHaveLength(1); expect(m.cc).toEqual(['financeiro@loja.test']);
      expect(m.texto).toContain('R$ 180,00'); expect(m.texto).toContain('br.gov.bcb.pix'); expect(m.texto).toContain('Banco Exemplo');
      expect(m.anexos![0]).toMatchObject({ tipo: 'application/pdf' }); expect(m.anexos![0]!.conteudo.subarray(0, 5).toString()).toBe('%PDF-');
      expect(await envios(f.faturaId)).toEqual([expect.objectContaining({ tipo: 'LEMBRETE', dias: 3, status: 'ENVIADO', automatico: true })]);
    });
    it('rodar de novo no mesmo dia não manda o mesmo aviso outra vez', async () => {
      const antes = caixa.enviados.length;
      expect((await processar()).enviados).toBe(0);
      expect(caixa.enviados.length).toBe(antes);
    });
    it('aviso de atraso 1 dia depois do vencimento, com multa e juros do dia no valor', async () => {
      caixa.enviados.length = 0;
      const f = await novaFatura(dias(-1), dias(-6));
      await processar();
      const m = caixa.enviados.find((x) => x.assunto.includes(`nº ${f.numero}`))!;
      expect(m.assunto).toMatch(/vencida há 1 dia/);
      expect(m.texto).toContain('(com multa e juros de hoje)'); expect(m.texto).toContain('R$ 183,66'); // 180 + multa 3,60 + juros de 1 dia (0,06)
    });
    it('sem aviso em dias que a régua não prevê', async () => {
      caixa.enviados.length = 0;
      const f = await novaFatura(dias(-2), dias(-8)); // 2 dias de atraso: a régua é 1 e 7
      await processar();
      expect(await envios(f.faturaId)).toEqual([]);
    });
    it('com "enviar ao gerar", a fatura nova sai uma vez com o PDF', async () => {
      await ger.put('/cobranca/regua', { enviarAoGerar: true });
      caixa.enviados.length = 0;
      const f = await novaFatura(dias(20), hoje());
      await processar(); await processar();
      expect((await envios(f.faturaId)).map((e) => e.tipo)).toEqual(['FATURA']);
      expect(caixa.enviados.filter((m) => m.assunto.includes(`nº ${f.numero}`))).toHaveLength(1);
      await ger.put('/cobranca/regua', { enviarAoGerar: false });
    });
    it('fatura paga ou cancelada não recebe aviso', async () => {
      const f = await novaFatura(dias(3), hoje());
      const banco = (await ger.get('/caixa/contas')).body.contas[0].id as string;
      await ger.post(`/faturas/${f.faturaId}/baixas`, { contaId: banco });
      await processar();
      expect(await envios(f.faturaId)).toEqual([]);
    });
  });

  describe('falhas registradas', () => {
    it('cliente sem e-mail de cobrança: registra "sem destinatário" e segue', async () => {
      const f = await novaFatura(dias(3), hoje(), { emailsCobranca: [] });
      await processar();
      expect(await envios(f.faturaId)).toEqual([expect.objectContaining({ status: 'SEM_DESTINATARIO', erro: 'O cliente não tem e-mail de cobrança cadastrado.' })]);
    });
    it('servidor de e-mail fora do ar: fica como erro, com a mensagem, e os outros avisos continuam', async () => {
      caixa.modo = 'erro';
      const f = await novaFatura(dias(3), hoje());
      const r = await processar();
      expect(r.erros).toBeGreaterThanOrEqual(1);
      expect((await envios(f.faturaId))[0]).toMatchObject({ status: 'ERRO' });
      caixa.modo = 'ok';
    });
    it('sem SMTP configurado: registra "sem configuração" em vez de fingir que enviou', async () => {
      caixa.modo = 'semConfiguracao';
      const f = await novaFatura(dias(3), hoje());
      await processar();
      expect((await envios(f.faturaId))[0]).toMatchObject({ status: 'SEM_CONFIGURACAO' });
      caixa.modo = 'ok';
    });
  });

  describe('envio manual', () => {
    it('manda a fatura agora (para os e-mails do cliente ou outros informados), quantas vezes precisar', async () => {
      caixa.enviados.length = 0;
      const f = await novaFatura(dias(10), hoje());
      expect((await ger.post(`/faturas/${f.faturaId}/enviar-email`, {})).body).toMatchObject({ status: 'ENVIADO' });
      expect((await ger.post(`/faturas/${f.faturaId}/enviar-email`, { para: ['outro@cliente.test'] })).body).toMatchObject({ status: 'ENVIADO' });
      expect(caixa.enviados.map((m) => m.para[0])).toContain('outro@cliente.test');
      expect((await envios(f.faturaId)).filter((e) => e.tipo === 'MANUAL')).toHaveLength(2);
      expect(caixa.enviados[0]!.assunto).toMatch(/^Fatura nº/);
    });
    it('recusa e-mail inválido, fatura cancelada e quem não pode', async () => {
      const f = await novaFatura(dias(10), hoje());
      expect((await ger.post(`/faturas/${f.faturaId}/enviar-email`, { para: ['isso-nao-e-email'] })).status).toBe(422);
      expect((await vis.post(`/faturas/${f.faturaId}/enviar-email`, {})).status).toBe(403);
      expect((await gerA2.post(`/faturas/${f.faturaId}/enviar-email`, {})).status).toBe(404);
      await ger.post(`/faturas/${f.faturaId}/cancelar`, { motivo: 'Fatura gerada por engano' });
      expect((await ger.post(`/faturas/${f.faturaId}/enviar-email`, {})).status).toBe(422);
    });
  });

  describe('agendador e isolamento', () => {
    it('processa todas as lojas ativas de todos os grupos de uma vez', async () => {
      caixa.enviados.length = 0;
      await novaFatura(dias(3), hoje());
      const r = await app.get(CobrancaService).processarTodas();
      expect(r.grupos).toBeGreaterThanOrEqual(2); expect(r.enviados).toBeGreaterThanOrEqual(1);
    });
    it('outra loja e outro grupo não veem os envios', async () => {
      expect((await gerA2.get('/cobranca/envios')).body).toEqual([]);
      const n = async (ctx: { grupoId: string; rede: boolean; empresas: string[] }, t: string) => (await db.tenant(ctx, (c) => c.query(`SELECT 1 FROM ${t}`))).rowCount;
      for (const t of ['envio_email', 'regua_cobranca']) {
        expect(await n({ grupoId: cen.A.grupoId, rede: true, empresas: [] }, t), t).toBeGreaterThan(0);
        expect(await n({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, t), t).toBe(0);
        expect(await n({ grupoId: cen.A.grupoId, rede: false, empresas: [cen.A.empresaIds[1]!] }, t), t).toBe(0);
      }
    });
    it('as ações ficam no log', async () => {
      const acoes = ((await adm.get('/auditoria?limite=200')).body.itens as { acao: string }[]).map((i) => i.acao);
      expect(acoes).toEqual(expect.arrayContaining(['cobranca.regua_alterada', 'cobranca.processada', 'cobranca.email_manual']));
    });
  });
});
