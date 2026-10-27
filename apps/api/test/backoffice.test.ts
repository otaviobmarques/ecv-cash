import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PapelInterno } from '@ecv/shared';
import type { DbService } from '../src/db/db.service';
import { Cripto } from '../src/common/cripto';
import { CHAVE_DEV } from '../src/config/env';
import { hashSenha } from '../src/auth/senha';
import { codigoTotp, novoSegredoTotp, passoAtual } from '../src/backoffice/totp';
import { SENHA, cliente, criarCenario, gerarCnpj, subirApp, unico } from './helpers';

describe('backoffice', () => {
  let app: INestApplication;
  let db: DbService;
  const cripto = new Cripto(CHAVE_DEV);
  const s = unico();
  const mail = (n: string) => `${n}.${s}@interno.local`;
  const segredos = new Map<string, string>();

  async function criarInterno(papel: PapelInterno, comMfa = true) {
    const email = mail(papel.toLowerCase() + unico());
    const segredo = novoSegredoTotp();
    const hash = await hashSenha(SENHA);
    const id = (await db.semTenant((c) => c.query(
      'INSERT INTO usuario_interno (nome, email, senha_hash, papel, mfa_secret) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [`Interno ${papel}`, email, hash, papel, comMfa ? cripto.cifrar(segredo) : null]))).rows[0].id;
    segredos.set(email, segredo);
    return { id, email, segredo };
  }

  /** Entra com senha e código. Zera o último passo para o teste poder entrar várias vezes no mesmo intervalo de 30 s. */
  async function entrarInterno(papel: PapelInterno) {
    const u = await criarInterno(papel);
    const c = cliente(app);
    const r1 = await c.post('/backoffice/auth/login', { email: u.email, senha: SENHA });
    expect(r1.status).toBe(200);
    expect(r1.body.etapa).toBe('MFA');
    const r2 = await c.post('/backoffice/auth/mfa', { ticket: r1.body.ticket, codigo: codigoTotp(u.segredo, passoAtual()) });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    return { c, u, eu: r2.body };
  }

  const novoGrupo = (nome = `Cliente ${unico()}`) => ({
    nome,
    empresa: { cnpj: gerarCnpj(), razaoSocial: `${nome} Vistorias Ltda`, nomeFantasia: nome, uf: 'SP', cidade: 'Santos', regimeTributario: 'SIMPLES_NACIONAL' },
    administrativo: { nome: 'Dona do Grupo', email: `dono.${unico()}@cliente.local` },
  });

  async function grupoComAdmin(bo: Awaited<ReturnType<typeof entrarInterno>>) {
    const dto = novoGrupo();
    const r = await bo.c.post('/backoffice/grupos', dto);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const token = new URL(r.body.conviteLink).searchParams.get('token')!;
    const adm = cliente(app);
    expect((await adm.post('/auth/aceitar-convite', { token, senha: 'Senha-da-dona-1' })).status).toBe(204);
    expect((await adm.login(dto.administrativo.email, 'Senha-da-dona-1')).status).toBe(200);
    return { dto, grupoId: r.body.grupoId as string, adm };
  }

  beforeAll(async () => { ({ app, db } = await subirApp()); });
  afterAll(() => app.close());

  describe('login com 2FA', () => {
    it('primeiro acesso: configura o autenticador, e dali em diante pede o código', async () => {
      const u = await criarInterno('SUPORTE', false);
      const c = cliente(app);
      const r1 = await c.post('/backoffice/auth/login', { email: u.email, senha: SENHA });
      expect(r1.body.etapa).toBe('CONFIGURAR_MFA');
      expect(r1.body.uri).toMatch(/^otpauth:\/\/totp\//);
      expect(r1.body.segredo).toMatch(/^[A-Z2-7]{32}$/);
      expect((await c.post('/backoffice/auth/mfa', { ticket: r1.body.ticket, codigo: '000000' })).status).toBe(401);
      const ok = await c.post('/backoffice/auth/mfa', { ticket: r1.body.ticket, codigo: codigoTotp(r1.body.segredo, passoAtual()) });
      expect(ok.status).toBe(200);
      expect(ok.headers['set-cookie']?.[0]).toMatch(/ecv_bo=.+HttpOnly.+SameSite=Strict/i);
      const guardado = (await db.semTenant((cc) => cc.query('SELECT mfa_secret FROM usuario_interno WHERE id = $1', [u.id]))).rows[0].mfa_secret;
      expect(guardado).not.toContain(r1.body.segredo); // cifrado no banco
      const outro = await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: SENHA });
      expect(outro.body.etapa).toBe('MFA');
    });

    it('o mesmo código não vale duas vezes', async () => {
      const u = await criarInterno('PLATAFORMA');
      const codigo = codigoTotp(u.segredo, passoAtual());
      const a = await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: SENHA });
      expect((await cliente(app).post('/backoffice/auth/mfa', { ticket: a.body.ticket, codigo })).status).toBe(200);
      const b = await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: SENHA });
      expect((await cliente(app).post('/backoffice/auth/mfa', { ticket: b.body.ticket, codigo })).status).toBe(401);
    });

    it('senha errada e usuário inexistente dão a mesma resposta; ticket adulterado é recusado', async () => {
      const u = await criarInterno('PLATAFORMA');
      const a = await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: 'errada-12345' });
      const b = await cliente(app).post('/backoffice/auth/login', { email: 'ninguem@interno.local', senha: 'errada-12345' });
      expect(a.status).toBe(401); expect(b.body).toEqual(a.body);
      expect((await cliente(app).post('/backoffice/auth/mfa', { ticket: 'x'.repeat(40), codigo: '123456' })).status).toBe(401);
    });

    it('bloqueia depois de 5 erros de código', async () => {
      const u = await criarInterno('SUPORTE');
      for (let i = 0; i < 5; i++) {
        const l = await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: SENHA });
        expect(l.status).toBe(200);
        expect((await cliente(app).post('/backoffice/auth/mfa', { ticket: l.body.ticket, codigo: '111111' })).status).toBe(401);
      }
      expect((await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: SENHA })).status).toBe(429);
    });

    it('usuário interno inativo não entra', async () => {
      const u = await criarInterno('SUPORTE');
      await db.semTenant((c) => c.query(`UPDATE usuario_interno SET status = 'INATIVO' WHERE id = $1`, [u.id]));
      expect((await cliente(app).post('/backoffice/auth/login', { email: u.email, senha: SENHA })).status).toBe(401);
    });
  });

  describe('permissões internas e separação de sessões', () => {
    it('sem login tudo responde 401', async () => {
      expect((await cliente(app).get('/backoffice/grupos')).status).toBe(401);
      expect((await cliente(app).get('/backoffice/auth/eu')).status).toBe(401);
    });

    it('cada papel faz só o que a matriz permite', async () => {
      const plataforma = await entrarInterno('PLATAFORMA');
      const operacoes = await entrarInterno('OPERACOES');
      const suporte = await entrarInterno('SUPORTE');
      const { grupoId } = await grupoComAdmin(plataforma);
      expect((await suporte.c.post('/backoffice/grupos', novoGrupo())).status).toBe(403);
      expect((await suporte.c.patch(`/backoffice/grupos/${grupoId}/status`, { status: 'SUSPENSO', motivo: 'Inadimplência há 60 dias' })).status).toBe(403);
      expect((await operacoes.c.post(`/backoffice/grupos/${grupoId}/entrar-como`, { motivo: 'Reproduzir um problema' })).status).toBe(403);
      expect((await operacoes.c.post('/backoffice/grupos', novoGrupo())).status).toBe(201);
      for (const x of [plataforma, operacoes, suporte]) {
        expect((await x.c.get('/backoffice/grupos')).status).toBe(200);
        expect((await x.c.get(`/backoffice/grupos/${grupoId}/auditoria`)).status).toBe(200);
      }
      expect(suporte.eu.permissoes).toContain('suporte.entrar_como');
      expect(suporte.eu.permissoes).not.toContain('grupo.criar');
    });

    it('a sessão do backoffice não abre rotas do cliente, e a do cliente não abre o backoffice', async () => {
      const bo = await entrarInterno('PLATAFORMA');
      expect((await bo.c.get('/empresas')).status).toBe(401);
      const cen = await criarCenario(db);
      const cli = cliente(app);
      await cli.login(cen.mail('adminA'));
      expect((await cli.get('/backoffice/grupos')).status).toBe(401);
    });

    it('logout encerra a sessão interna no servidor', async () => {
      const bo = await entrarInterno('SUPORTE');
      expect((await bo.c.post('/backoffice/auth/logout')).status).toBe(204);
      expect((await bo.c.get('/backoffice/grupos')).status).toBe(401);
    });
  });

  describe('grupos', () => {
    it('cria o grupo com empresa e primeiro Administrativo que aceita o convite e só vê o próprio grupo', async () => {
      const bo = await entrarInterno('OPERACOES');
      const { dto, adm } = await grupoComAdmin(bo);
      const eu = (await adm.get('/auth/eu')).body;
      expect(eu.perfilAtivo).toBe('ADMINISTRATIVO');
      const empresas = (await adm.get('/empresas')).body;
      expect(empresas).toHaveLength(1);
      expect(empresas[0].nomeFantasia).toBe(dto.empresa.nomeFantasia);
    });

    it('recusa CNPJ inválido, CNPJ repetido e e-mail repetido', async () => {
      const bo = await entrarInterno('PLATAFORMA');
      const dto = novoGrupo();
      expect((await bo.c.post('/backoffice/grupos', { ...dto, empresa: { ...dto.empresa, cnpj: '12345678000100' } })).status).toBe(422);
      expect((await bo.c.post('/backoffice/grupos', dto)).status).toBe(201);
      expect((await bo.c.post('/backoffice/grupos', { ...novoGrupo(), empresa: dto.empresa })).status).toBe(409);
      expect((await bo.c.post('/backoffice/grupos', { ...novoGrupo(), administrativo: dto.administrativo })).status).toBe(409);
      // a tentativa que falhou não deixa grupo pela metade
      const lista = (await bo.c.get('/backoffice/grupos')).body as { nome: string }[];
      expect(lista.filter((g) => g.nome === dto.nome)).toHaveLength(1);
    });

    it('lista com contagens e sem expor usuários nem segredos', async () => {
      const bo = await entrarInterno('SUPORTE');
      const r = await bo.c.get('/backoffice/grupos');
      expect(r.status).toBe(200);
      expect(Object.keys(r.body[0]).sort()).toEqual(['criadoEm', 'empresas', 'id', 'nome', 'status', 'ultimoAcesso', 'usuarios']);
      expect(JSON.stringify(r.body)).not.toMatch(/senha|hash|mfa/i);
    });

    it('suspender exige motivo, bloqueia o cliente na hora e reativar devolve o acesso', async () => {
      const bo = await entrarInterno('OPERACOES');
      const { grupoId, dto, adm } = await grupoComAdmin(bo);
      expect((await bo.c.patch(`/backoffice/grupos/${grupoId}/status`, { status: 'SUSPENSO', motivo: 'curto' })).status).toBe(422);
      expect((await bo.c.patch(`/backoffice/grupos/${grupoId}/status`, { status: 'SUSPENSO', motivo: 'Inadimplência há 60 dias' })).status).toBe(200);
      expect((await adm.get('/auth/eu')).status).toBe(401); // sessão aberta cai
      expect((await cliente(app).login(dto.administrativo.email, 'Senha-da-dona-1')).status).toBe(403);
      expect((await bo.c.patch(`/backoffice/grupos/${grupoId}/status`, { status: 'ATIVO', motivo: 'Pagamento regularizado' })).status).toBe(200);
      expect((await cliente(app).login(dto.administrativo.email, 'Senha-da-dona-1')).status).toBe(200);
      const log = (await bo.c.get(`/backoffice/grupos/${grupoId}/auditoria`)).body as { acao: string; autor: string; motivo: string | null }[];
      const susp = log.find((l) => l.acao === 'grupo.suspenso')!;
      expect(susp.autor).toMatch(/^Equipe ECV Cash: /);
      expect(susp.motivo).toBe('Inadimplência há 60 dias');
    });

    it('detalhe mostra empresas, usuários e acessos de suporte do grupo', async () => {
      const suporte = await entrarInterno('SUPORTE');
      const { grupoId } = await grupoComAdmin(await entrarInterno('PLATAFORMA'));
      const d = (await suporte.c.get(`/backoffice/grupos/${grupoId}`)).body;
      expect(d.empresas).toHaveLength(1);
      expect(d.usuarios[0].acessoRede).toBe(true);
      expect(d.acessosSuporte).toEqual([]);
    });
  });

  describe('entrar como o cliente (suporte)', () => {
    it('fluxo completo: motivo, ticket de uso único, banner, ações auditadas com o autor interno, sessão curta', async () => {
      const plataforma = await entrarInterno('PLATAFORMA');
      const suporte = await entrarInterno('SUPORTE');
      const { grupoId, adm } = await grupoComAdmin(plataforma);

      expect((await suporte.c.post(`/backoffice/grupos/${grupoId}/entrar-como`, { motivo: 'curto' })).status).toBe(422);
      const r = await suporte.c.post(`/backoffice/grupos/${grupoId}/entrar-como`, { motivo: 'Cliente não consegue baixar fatura (chamado 1234)' });
      expect(r.status).toBe(201);
      expect(r.body.url).toMatch(/\/suporte#ticket=/);

      const app2 = cliente(app);
      const troca = await app2.post('/auth/suporte', { ticket: r.body.ticket });
      expect(troca.status).toBe(200);
      expect(troca.body.suporte).toMatchObject({ usuarioInterno: 'Interno SUPORTE', motivo: 'Cliente não consegue baixar fatura (chamado 1234)' });
      expect(troca.body.perfilAtivo).toBe('ADMINISTRATIVO');
      expect((await cliente(app).post('/auth/suporte', { ticket: r.body.ticket })).status).toBe(400); // uso único

      // uma ação durante o suporte fica registrada com a pessoa da equipe interna
      const empresaId = (await app2.get('/empresas')).body[0].id;
      expect((await app2.patch(`/empresas/${empresaId}`, { cidade: 'Guarujá' })).status).toBe(200);
      const log = (await adm.get('/auditoria?limite=50')).body.itens as { acao: string }[];
      expect(log.map((l) => l.acao)).toEqual(expect.arrayContaining(['suporte.acesso_iniciado', 'suporte.sessao_aberta', 'empresa.editada']));
      const linha = (await db.tenant({ grupoId, rede: true, empresas: [] }, (c) => c.query(`SELECT usuario_interno_id FROM auditoria_log WHERE acao = 'empresa.editada'`))).rows[0];
      expect(linha.usuario_interno_id).toBe(suporte.eu.id);

      // no log do cliente a autoria é da equipe interna, nunca do usuário em cujo nome o suporte entrou
      const itens = (await adm.get('/auditoria?limite=50')).body.itens as { acao: string; usuario: string }[];
      expect(itens.find((i) => i.acao === 'empresa.editada')!.usuario).toBe('Equipe ECV Cash: Interno SUPORTE');
      expect(itens.find((i) => i.acao === 'suporte.sessao_aberta')!.usuario).toMatch(/^Equipe ECV Cash: /);

      // o detalhe do grupo lista o acesso
      expect(((await suporte.c.get(`/backoffice/grupos/${grupoId}`)).body.acessosSuporte as unknown[]).length).toBe(1);

      // encerrar
      expect((await app2.post('/auth/logout')).status).toBe(204);
      expect((await app2.get('/auth/eu')).status).toBe(401);
      const enc = (await suporte.c.get(`/backoffice/grupos/${grupoId}`)).body.acessosSuporte[0];
      expect(enc.encerradaEm).toBeTruthy();
    });

    it('a sessão de suporte vence em 30 minutos', async () => {
      const bo = await entrarInterno('PLATAFORMA');
      const { grupoId } = await grupoComAdmin(bo);
      const r = await bo.c.post(`/backoffice/grupos/${grupoId}/entrar-como`, { motivo: 'Conferir cadastro de preços' });
      const app2 = cliente(app);
      expect((await app2.post('/auth/suporte', { ticket: r.body.ticket })).status).toBe(200);
      const dur = (new Date(r.body.expiraEm).getTime() - Date.now()) / 60_000;
      expect(dur).toBeGreaterThan(29); expect(dur).toBeLessThanOrEqual(30);
      await db.semTenant((c) => c.query(`UPDATE sessao_suporte SET expira_em = now() - interval '1 minute' WHERE grupo_id = $1`, [grupoId]));
      expect((await app2.get('/auth/eu')).status).toBe(401);
    });

    it('não entra em grupo suspenso nem com ticket inventado', async () => {
      const bo = await entrarInterno('PLATAFORMA');
      const { grupoId } = await grupoComAdmin(bo);
      await bo.c.patch(`/backoffice/grupos/${grupoId}/status`, { status: 'SUSPENSO', motivo: 'Pedido do próprio cliente' });
      expect((await bo.c.post(`/backoffice/grupos/${grupoId}/entrar-como`, { motivo: 'Tentar entrar mesmo assim' })).status).toBe(409);
      expect((await cliente(app).post('/auth/suporte', { ticket: 'a'.repeat(43) })).status).toBe(400);
    });
  });

  describe('redefinir acesso', () => {
    it('derruba as sessões, apaga a senha e libera um convite novo', async () => {
      const bo = await entrarInterno('SUPORTE');
      const plataforma = await entrarInterno('PLATAFORMA');
      const { grupoId, dto, adm } = await grupoComAdmin(plataforma);
      const usuarioId = (await adm.get('/auth/eu')).body.id;
      const r = await bo.c.post(`/backoffice/grupos/${grupoId}/usuarios/${usuarioId}/redefinir-acesso`);
      expect(r.status).toBe(201);
      expect((await adm.get('/auth/eu')).status).toBe(401);
      expect((await cliente(app).login(dto.administrativo.email, 'Senha-da-dona-1')).status).toBe(401);
      const token = new URL(r.body.conviteLink).searchParams.get('token')!;
      expect((await cliente(app).post('/auth/aceitar-convite', { token, senha: 'Outra-senha-2026' })).status).toBe(204);
      expect((await cliente(app).login(dto.administrativo.email, 'Outra-senha-2026')).status).toBe(200);
    });

    it('não mexe em usuário de outro grupo', async () => {
      const bo = await entrarInterno('SUPORTE');
      const plataforma = await entrarInterno('PLATAFORMA');
      const a = await grupoComAdmin(plataforma);
      const b = await grupoComAdmin(plataforma);
      const usuarioB = (await b.adm.get('/auth/eu')).body.id;
      expect((await bo.c.post(`/backoffice/grupos/${a.grupoId}/usuarios/${usuarioB}/redefinir-acesso`)).status).toBe(404);
      expect((await b.adm.get('/auth/eu')).status).toBe(200);
    });
  });
});
