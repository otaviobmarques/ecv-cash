import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { competenciasDevidas, primeiroDiaDoMes, somarMeses, type PapelInterno } from '@ecv/shared';
import type { DbService } from '../src/db/db.service';
import { Cripto } from '../src/common/cripto';
import { CHAVE_DEV } from '../src/config/env';
import { hashSenha } from '../src/auth/senha';
import { codigoTotp, novoSegredoTotp, passoAtual } from '../src/backoffice/totp';
import { AssinaturaService } from '../src/assinatura/assinatura.service';
import { hojeSP } from '../src/caixa/razao';
import { SENHA, cliente, criarCenario, gerarCnpj, subirApp, unico } from './helpers';

const diasAtras = (n: number) => new Date(Date.parse(`${hojeSP()}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe('assinatura do SaaS', () => {
  let app: INestApplication;
  let db: DbService;
  let svc: AssinaturaService;
  const cripto = new Cripto(CHAVE_DEV);

  async function entrar(papel: PapelInterno) {
    const email = `${papel.toLowerCase()}.${unico()}@interno.local`;
    const segredo = novoSegredoTotp();
    await db.semTenant(async (c) => c.query('INSERT INTO usuario_interno (nome, email, senha_hash, papel, mfa_secret) VALUES ($1,$2,$3,$4,$5)', [`Interno ${papel}`, email, await hashSenha(SENHA), papel, cripto.cifrar(segredo)]));
    const c = cliente(app);
    const r1 = await c.post('/backoffice/auth/login', { email, senha: SENHA });
    const r2 = await c.post('/backoffice/auth/mfa', { ticket: r1.body.ticket, codigo: codigoTotp(segredo, passoAtual()) });
    expect(r2.status).toBe(200);
    return c;
  }

  /** Grupo novo com um administrativo que entra no sistema do cliente. */
  async function grupoNovo(bo: Awaited<ReturnType<typeof entrar>>) {
    const nome = `Cliente SaaS ${unico()}`;
    const r = await bo.post('/backoffice/grupos', {
      nome, empresa: { cnpj: gerarCnpj(), razaoSocial: `${nome} Ltda`, nomeFantasia: nome, uf: 'SP', cidade: 'Santos', regimeTributario: 'SIMPLES_NACIONAL' },
      administrativo: { nome: 'Dona', email: `dona.${unico()}@cliente.local` },
    });
    expect(r.status).toBe(201);
    return r.body.grupoId as string;
  }

  let plataforma: Awaited<ReturnType<typeof entrar>>;
  let operacoes: Awaited<ReturnType<typeof entrar>>;
  let suporte: Awaited<ReturnType<typeof entrar>>;
  let planoId: string;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    svc = app.get(AssinaturaService);
    [plataforma, operacoes, suporte] = [await entrar('PLATAFORMA'), await entrar('OPERACOES'), await entrar('SUPORTE')];
    const p = await plataforma.post('/backoffice/planos', { nome: `Plano ${unico()}`, valorBaseCentavos: 19900, empresasIncluidas: 1, valorEmpresaAdicionalCentavos: 5000 });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    planoId = p.body.id;
  });
  afterAll(() => app.close());

  it('planos: só a Plataforma cria; Suporte só vê; nome repetido é recusado', async () => {
    expect((await operacoes.post('/backoffice/planos', { nome: 'X plano', valorBaseCentavos: 100, empresasIncluidas: 1, valorEmpresaAdicionalCentavos: 0 })).status).toBe(403);
    expect((await suporte.get('/backoffice/planos')).status).toBe(200);
    const nome = `Dup ${unico()}`;
    const corpo = { nome, valorBaseCentavos: 100, empresasIncluidas: 1, valorEmpresaAdicionalCentavos: 0 };
    expect((await plataforma.post('/backoffice/planos', corpo)).status).toBe(201);
    expect((await plataforma.post('/backoffice/planos', corpo)).status).toBe(409);
    expect((await plataforma.post('/backoffice/planos', { ...corpo, nome: 'Float', valorBaseCentavos: 10.5 })).status).toBe(422);
  });

  it('contrato: gera as mensalidades devidas com o preço combinado e desconto', async () => {
    const g = await grupoNovo(operacoes);
    const inicio = diasAtras(40);
    const dto = { planoId, descontoBp: 1000, diaVencimento: 10, inicio, carenciaDias: 15 };
    expect((await suporte.post(`/backoffice/grupos/${g}/assinatura`, dto)).status).toBe(403);
    const r = await operacoes.post(`/backoffice/grupos/${g}/assinatura`, dto);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await operacoes.post(`/backoffice/grupos/${g}/assinatura`, dto)).status).toBe(409);
    const { assinatura, cobrancas } = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body;
    expect(assinatura).toMatchObject({ status: 'ATIVA', valorBaseCentavos: 19900, descontoBp: 1000 });
    expect(cobrancas.length).toBe(competenciasDevidas({ inicio, diaVencimento: 10 }, hojeSP()).length);
    expect(cobrancas[0]).toMatchObject({ valorBrutoCentavos: 19900, descontoCentavos: 1990, valorCentavos: 17910, status: 'ABERTA', empresasCobradas: 1 });
    // gerar de novo não duplica
    expect((await operacoes.post(`/backoffice/grupos/${g}/assinatura/gerar`)).body.geradas).toBe(0);
  });

  it('reajuste do plano não muda o contrato; edição do contrato vale só para as próximas', async () => {
    const g = await grupoNovo(operacoes);
    await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 5, inicio: diasAtras(10) });
    await plataforma.patch(`/backoffice/planos/${planoId}`, { valorBaseCentavos: 29900 });
    const antes = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body;
    expect(antes.assinatura.valorBaseCentavos).toBe(19900);
    await plataforma.patch(`/backoffice/planos/${planoId}`, { valorBaseCentavos: 19900 });
    expect((await operacoes.patch(`/backoffice/grupos/${g}/assinatura`, { valorBaseCentavos: 15000 })).status).toBe(422); // exige motivo
    expect((await operacoes.patch(`/backoffice/grupos/${g}/assinatura`, { valorBaseCentavos: 15000, motivo: 'Desconto negociado com o dono' })).status).toBe(200);
    const depois = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body;
    expect(depois.assinatura.valorBaseCentavos).toBe(15000);
    for (const m of depois.cobrancas) expect(m.valorCentavos).toBe(19900); // já geradas, congeladas
  });

  it('período de teste: não cobra enquanto dura', async () => {
    const g = await grupoNovo(operacoes);
    const hoje = hojeSP();
    await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 10, inicio: diasAtras(20), testeAte: somarMeses(primeiroDiaDoMes(hoje), 1).replace(/01$/, '28') });
    expect((await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body.cobrancas).toHaveLength(0);
    expect((await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 10, inicio: hoje })).status).toBe(409); // já tem
  });

  it('baixa e cancelamento de mensalidade, sempre com registro e sem reabrir', async () => {
    const g = await grupoNovo(operacoes);
    await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 10, inicio: diasAtras(40) });
    const lista = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body.cobrancas as { id: string; status: string }[];
    const [a, b] = lista;
    expect((await suporte.post(`/backoffice/grupos/${g}/cobrancas/${a!.id}/baixar`, { pagoEm: hojeSP(), forma: 'PIX' })).status).toBe(403);
    expect((await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${a!.id}/baixar`, { pagoEm: '2999-01-01', forma: 'PIX' })).status).toBe(422);
    expect((await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${a!.id}/baixar`, { pagoEm: hojeSP(), forma: 'PIX', referencia: 'E2E123' })).status).toBe(201);
    expect((await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${a!.id}/baixar`, { pagoEm: hojeSP(), forma: 'PIX' })).status).toBe(409);
    expect((await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${a!.id}/cancelar`, { motivo: 'Tentativa de cancelar paga' })).status).toBe(409);
    // paga fica congelada no banco
    await expect(db.tenant({ grupoId: g, rede: true, empresas: [] }, (c) => c.query(`UPDATE cobranca_saas SET valor_centavos = 1, valor_bruto_centavos = 1 WHERE id = $1`, [a!.id]))).rejects.toMatchObject({ code: 'P0001' });
    expect((await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${b!.id}/cancelar`, { motivo: 'curto' })).status).toBe(422);
    expect((await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${b!.id}/cancelar`, { motivo: 'Cortesia de um mês ao cliente' })).status).toBe(201);
    expect((await operacoes.post(`/backoffice/grupos/${g}/assinatura/gerar`)).body.geradas).toBe(0); // a dispensada não volta
    const log = (await operacoes.get(`/backoffice/grupos/${g}/auditoria`)).body as { acao: string; autor: string }[];
    expect(log.map((e) => e.acao)).toEqual(expect.arrayContaining(['assinatura.contratada', 'assinatura.cobranca_paga', 'assinatura.cobranca_cancelada']));
    expect(log.find((e) => e.acao === 'assinatura.cobranca_paga')!.autor).toMatch(/^Equipe ECV Cash: /);
  });

  it('inadimplência: passa da carência, vira inadimplente e suspende o grupo; pagar tudo reativa', async () => {
    const g = await grupoNovo(operacoes);
    await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 10, inicio: diasAtras(70), carenciaDias: 15, suspendeEmAtraso: true });
    await svc.processarTodas();
    let ass = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body;
    expect(ass.assinatura).toMatchObject({ status: 'INADIMPLENTE', suspensoPorAtraso: true });
    expect((await operacoes.get(`/backoffice/grupos/${g}`)).body.status).toBe('SUSPENSO');
    const abertas = (ass.cobrancas as { id: string; status: string }[]).filter((m) => m.status === 'ABERTA');
    expect(abertas.length).toBeGreaterThan(1);
    // paga as mais novas e deixa a mais antiga: segue vencida, continua suspenso
    const maisAntiga = abertas[abertas.length - 1]!;
    for (const m of abertas.slice(0, -1)) await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${m.id}/baixar`, { pagoEm: hojeSP(), forma: 'TRANSFERENCIA' });
    expect((await operacoes.get(`/backoffice/grupos/${g}`)).body.status).toBe('SUSPENSO');
    await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${maisAntiga.id}/baixar`, { pagoEm: hojeSP(), forma: 'PIX' });
    ass = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body;
    expect(ass.assinatura).toMatchObject({ status: 'ATIVA', suspensoPorAtraso: false });
    expect((await operacoes.get(`/backoffice/grupos/${g}`)).body.status).toBe('ATIVO');
  });

  it('sem a opção de suspender, só marca inadimplente; suspensão manual da equipe não é desfeita pela cobrança', async () => {
    const g = await grupoNovo(operacoes);
    await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 10, inicio: diasAtras(70), carenciaDias: 15 });
    await svc.processarTodas();
    expect((await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body.assinatura.status).toBe('INADIMPLENTE');
    expect((await operacoes.get(`/backoffice/grupos/${g}`)).body.status).toBe('ATIVO');
    await operacoes.patch(`/backoffice/grupos/${g}/status`, { status: 'SUSPENSO', motivo: 'Pedido do próprio cliente' });
    const abertas = ((await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body.cobrancas as { id: string; status: string }[]).filter((m) => m.status === 'ABERTA');
    for (const m of abertas) await operacoes.post(`/backoffice/grupos/${g}/cobrancas/${m.id}/baixar`, { pagoEm: hojeSP(), forma: 'PIX' });
    expect((await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body.assinatura.status).toBe('ATIVA');
    expect((await operacoes.get(`/backoffice/grupos/${g}`)).body.status).toBe('SUSPENSO');
  });

  it('cancelar a assinatura dispensa o que está aberto e exige motivo', async () => {
    const g = await grupoNovo(operacoes);
    await operacoes.post(`/backoffice/grupos/${g}/assinatura`, { planoId, diaVencimento: 10, inicio: diasAtras(40) });
    expect((await operacoes.post(`/backoffice/grupos/${g}/assinatura/cancelar`, { motivo: 'curto' })).status).toBe(422);
    expect((await operacoes.post(`/backoffice/grupos/${g}/assinatura/cancelar`, { motivo: 'Cliente encerrou o contrato' })).status).toBe(201);
    const r = (await operacoes.get(`/backoffice/grupos/${g}/assinatura`)).body;
    expect(r.assinatura.status).toBe('CANCELADA');
    expect(r.cobrancas.every((m: { status: string }) => m.status === 'CANCELADA')).toBe(true);
    expect((await operacoes.patch(`/backoffice/grupos/${g}/assinatura`, { descontoBp: 5, motivo: 'Tentando editar cancelada' })).status).toBe(409);
  });

  it('lista global de mensalidades filtra por situação e por vencidas', async () => {
    const todas = (await operacoes.get('/backoffice/cobrancas')).body as { status: string; vencimento: string }[];
    expect(todas.length).toBeGreaterThan(0);
    const pagas = (await operacoes.get('/backoffice/cobrancas?status=PAGA')).body as { status: string }[];
    expect(pagas.every((m) => m.status === 'PAGA')).toBe(true);
    const vencidas = (await operacoes.get('/backoffice/cobrancas?vencidas=true')).body as { status: string; vencimento: string }[];
    expect(vencidas.every((m) => m.status === 'ABERTA' && m.vencimento < hojeSP())).toBe(true);
    expect((await operacoes.get('/backoffice/assinaturas')).status).toBe(200);
  });

  it('cliente: só o Administrativo vê a própria assinatura; aviso de atraso aparece', async () => {
    const cen = await criarCenario(db);
    await operacoes.post(`/backoffice/grupos/${cen.A.grupoId}/assinatura`, { planoId, diaVencimento: 10, inicio: diasAtras(50), carenciaDias: 30 });
    const adm = cliente(app); await adm.login(cen.mail('adminA'));
    const minha = await adm.get('/assinatura');
    expect(minha.status).toBe(200);
    expect(minha.body.assinatura).toMatchObject({ status: 'ATIVA' });
    expect(minha.body.empresasAtivas).toBe(2);
    expect(minha.body.cobrancas[0].valorCentavos).toBe(24900); // 2 empresas ativas, 1 incluída: 19900 + 5000
    expect(minha.body.mensalidadesEmAtraso).toBeGreaterThan(0);
    expect(minha.body.pix).toBeNull(); // sem chave PIX configurada
    expect((await adm.get('/assinatura/aviso')).body.tipo).toBe('atraso');
    const ger = cliente(app); await ger.login(cen.mail('gerenteA1'));
    expect((await ger.get('/assinatura')).status).toBe(403);
    expect((await ger.get('/assinatura/aviso')).body.tipo).toBe('nenhum');
    const admB = cliente(app); await admB.login(cen.mail('adminB'));
    expect((await admB.get('/assinatura')).body.assinatura).toBeNull(); // o grupo B não vê o contrato do A
  });
});
