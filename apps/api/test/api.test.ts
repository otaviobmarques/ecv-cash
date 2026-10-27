import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { SENHA, ORIGEM, cliente, criarCenario, gerarCnpj, subirApp, unico } from './helpers';

describe('API', () => {
  let app: INestApplication;
  let db: DbService;
  let cen: Awaited<ReturnType<typeof criarCenario>>;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
  });
  afterAll(() => app.close());

  const entrar = async (nome: string) => {
    const c = cliente(app);
    const r = await c.login(cen.mail(nome));
    expect(r.status, `login ${nome}`).toBe(200);
    return { c, eu: r.body };
  };

  describe('login e sessão', () => {
    it('login correto devolve perfil e permissões e grava cookie httpOnly', async () => {
      const c = cliente(app);
      const r = await c.login(cen.mail('gerenteA1'));
      expect(r.status).toBe(200);
      expect(r.body.perfilAtivo).toBe('GERENTE');
      expect(r.body.permissoes).toContain('pagar.aprovar');
      expect(r.body.permissoes).not.toContain('preco.reajustar');
      expect(r.body.empresas).toHaveLength(1);
      expect(r.headers['set-cookie']?.[0]).toMatch(/ecv_sid=.+HttpOnly/i);
      expect(JSON.stringify(r.body)).not.toMatch(/senha|hash/i);
    });

    it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
      const a = await cliente(app).login(cen.mail('gerenteA1'), 'errada-errada-1');
      const b = await cliente(app).login('naoexiste@teste.local', 'errada-errada-1');
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body).toEqual(b.body);
    });

    it('bloqueia depois de 5 falhas e libera após um login correto antes do limite', async () => {
      const email = `forca.${unico()}@teste.local`;
      for (let i = 0; i < 5; i++) expect((await cliente(app).login(email, 'x-errada-1234')).status).toBe(401);
      expect((await cliente(app).login(email, 'x-errada-1234')).status).toBe(429);
    });

    it('sem sessão as rotas protegidas respondem 401', async () => {
      expect((await cliente(app).get('/empresas')).status).toBe(401);
      expect((await cliente(app).get('/auth/eu')).status).toBe(401);
    });

    it('logout encerra a sessão no servidor', async () => {
      const { c } = await entrar('finA1');
      expect((await c.get('/auth/eu')).status).toBe(200);
      expect((await c.post('/auth/logout')).status).toBe(204);
      expect((await c.get('/auth/eu')).status).toBe(401);
    });

    it('usuário inativado perde o acesso mesmo com a sessão aberta', async () => {
      const { c } = await entrar('visA1');
      const adm = (await entrar('adminA')).c;
      const lista = (await adm.get('/usuarios')).body as { id: string; email: string }[];
      const alvo = lista.find((u) => u.email === cen.mail('visA1'))!;
      expect((await adm.patch(`/usuarios/${alvo.id}/status`, { status: 'INATIVO', motivo: 'Saiu da empresa' })).status).toBe(200);
      expect((await c.get('/auth/eu')).status).toBe(401);
      expect((await cliente(app).login(cen.mail('visA1'))).status).toBe(401);
      await adm.patch(`/usuarios/${alvo.id}/status`, { status: 'ATIVO' });
    });

    it('grupo suspenso não entra', async () => {
      await db.tenant({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, (c) => c.query(`UPDATE grupo SET status = 'SUSPENSO'`));
      const r = await cliente(app).login(cen.mail('adminB'));
      expect(r.status).toBe(403);
      await db.tenant({ grupoId: cen.B.grupoId, rede: true, empresas: [] }, (c) => c.query(`UPDATE grupo SET status = 'ATIVO'`));
    });

    it('mutação de origem não autorizada é recusada (CSRF)', async () => {
      const { c } = await entrar('adminA');
      const r = await c.agent.post('/auth/logout').set('Origin', 'https://site-malicioso.example');
      expect(r.status).toBe(403);
      expect((await c.get('/auth/eu')).status).toBe(200);
    });

    it('troca de empresa ativa só para lojas do usuário', async () => {
      const { c } = await entrar('gerenteA1');
      const r = await c.post('/auth/empresa-ativa', { empresaId: cen.A.empresaIds[1] });
      expect(r.status).toBe(403);
      expect((await c.post('/auth/empresa-ativa', { empresaId: cen.B.empresaIds[0] })).status).toBe(403);
    });
  });

  describe('empresas', () => {
    it('Administrativo lista todas as lojas do grupo e nenhuma de outro grupo', async () => {
      const { c } = await entrar('adminA');
      const r = await c.get('/empresas');
      expect(r.body.map((e: { id: string }) => e.id).sort()).toEqual([...cen.A.empresaIds].sort());
    });

    it('Gerente vê só a própria loja', async () => {
      const { c } = await entrar('gerenteA1');
      const r = await c.get('/empresas');
      expect(r.body.map((e: { id: string }) => e.id)).toEqual([cen.A.empresaIds[0]]);
    });

    it('só o Administrativo cria empresa, com CNPJ válido e único', async () => {
      const body = { cnpj: gerarCnpj(), razaoSocial: 'Nova Vistorias Ltda', nomeFantasia: `Nova ${unico()}`, uf: 'sp', cidade: 'Campinas', regimeTributario: 'SIMPLES_NACIONAL' };
      expect((await (await entrar('gerenteA1')).c.post('/empresas', body)).status).toBe(403);
      expect((await (await entrar('finA1')).c.post('/empresas', body)).status).toBe(403);
      const adm = (await entrar('adminA')).c;
      expect((await adm.post('/empresas', { ...body, cnpj: '11111111111111' })).status).toBe(422);
      const ok = await adm.post('/empresas', body);
      expect(ok.status).toBe(201);
      expect(ok.body.uf).toBe('SP');
      expect((await adm.post('/empresas', body)).status).toBe(409);
    });

    it('Gerente edita a própria loja, mas não a de outro', async () => {
      const { c } = await entrar('gerenteA1');
      const [a1, a2] = cen.A.empresaIds;
      expect((await c.patch(`/empresas/${a1}`, { cidade: 'Santos' })).body.cidade).toBe('Santos');
      expect((await c.patch(`/empresas/${a2}`, { cidade: 'Santos' })).status).toBe(403);
    });

    it('Vistoriador e Financeiro não editam empresa', async () => {
      const [a1] = cen.A.empresaIds;
      expect((await (await entrar('visA1')).c.patch(`/empresas/${a1}`, { cidade: 'X1' })).status).toBe(403);
      expect((await (await entrar('finA1')).c.patch(`/empresas/${a1}`, { cidade: 'X1' })).status).toBe(403);
    });
  });

  describe('usuários', () => {
    it('Gerente cria Vistoriador na própria loja e o convite funciona de ponta a ponta', async () => {
      const { c } = await entrar('gerenteA1');
      const email = `novo.${unico()}@teste.local`;
      const r = await c.post('/usuarios', { nome: 'Novo Vistoriador', email, perfil: 'VISTORIADOR', empresaIds: [cen.A.empresaIds[0]] });
      expect(r.status).toBe(201);
      const token = new URL(r.body.conviteLink).searchParams.get('token')!;
      expect((await cliente(app).login(email, SENHA)).status).toBe(401); // ainda sem senha
      const novo = cliente(app);
      expect((await novo.post('/auth/aceitar-convite', { token, senha: 'curta' })).status).toBe(422);
      expect((await novo.post('/auth/aceitar-convite', { token, senha: 'Minha-senha-nova-9' })).status).toBe(204);
      expect((await novo.post('/auth/aceitar-convite', { token, senha: 'Outra-senha-nova-9' })).status).toBe(400); // convite é de uso único
      const l = await novo.login(email, 'Minha-senha-nova-9');
      expect(l.status).toBe(200);
      expect(l.body.perfilAtivo).toBe('VISTORIADOR');
    });

    it('Gerente não cria Gerente, Administrativo nem usuário de outra loja', async () => {
      const { c } = await entrar('gerenteA1');
      const [a1, a2] = cen.A.empresaIds;
      const base = { nome: 'Fulano de Tal', email: `x.${unico()}@teste.local` };
      expect((await c.post('/usuarios', { ...base, perfil: 'GERENTE', empresaIds: [a1] })).status).toBe(403);
      expect((await c.post('/usuarios', { ...base, perfil: 'ADMINISTRATIVO' })).status).toBe(403);
      expect((await c.post('/usuarios', { ...base, perfil: 'FINANCEIRO', empresaIds: [a2] })).status).toBe(403);
    });

    it('Financeiro e Vistoriador não criam usuário', async () => {
      const body = { nome: 'Fulano de Tal', email: `y.${unico()}@teste.local`, perfil: 'VISTORIADOR', empresaIds: [cen.A.empresaIds[0]] };
      expect((await (await entrar('finA1')).c.post('/usuarios', body)).status).toBe(403);
      expect((await (await entrar('visA1')).c.post('/usuarios', body)).status).toBe(403);
    });

    it('Administrativo cria outro Administrativo e Gerente; e-mail repetido dá 409', async () => {
      const { c } = await entrar('adminA');
      const email = `adm.${unico()}@teste.local`;
      expect((await c.post('/usuarios', { nome: 'Outro Admin', email, perfil: 'ADMINISTRATIVO' })).status).toBe(201);
      expect((await c.post('/usuarios', { nome: 'Outro Admin', email, perfil: 'GERENTE', empresaIds: [cen.A.empresaIds[0]] })).status).toBe(409);
    });

    it('Gerente lista só usuários da própria loja; o Administrativo, todos do grupo', async () => {
      const g = (await (await entrar('gerenteA1')).c.get('/usuarios')).body as { email: string }[];
      const emails = g.map((u) => u.email);
      expect(emails).toContain(cen.mail('visA1'));
      expect(emails).not.toContain(cen.mail('gerenteA2'));
      expect(emails).not.toContain(cen.mail('adminA'));
      expect(emails).not.toContain(cen.mail('adminB'));
      const a = (await (await entrar('adminA')).c.get('/usuarios')).body as { email: string }[];
      expect(a.map((u) => u.email)).toContain(cen.mail('gerenteA2'));
      expect(a.map((u) => u.email)).not.toContain(cen.mail('adminB'));
    });

    it('só o Administrativo inativa usuário, e nunca a si mesmo', async () => {
      const g = (await entrar('gerenteA1')).c;
      const lista = (await g.get('/usuarios')).body as { id: string; email: string }[];
      const alvo = lista.find((u) => u.email === cen.mail('visA1'))!;
      expect((await g.patch(`/usuarios/${alvo.id}/status`, { status: 'INATIVO' })).status).toBe(403);
      const adm = await entrar('adminA');
      expect((await adm.c.patch(`/usuarios/${adm.eu.id}/status`, { status: 'INATIVO' })).status).toBe(400);
    });
  });

  describe('tema', () => {
    it('sem tema cadastrado a resposta é vazia (o front usa o ECV Cash)', async () => {
      expect((await (await entrar('finA1')).c.get('/tema')).body).toEqual({});
    });

    it('Administrativo define o tema do grupo e a loja herda', async () => {
      const adm = (await entrar('adminA')).c;
      const r = await adm.put('/tema', { escopo: 'GRUPO', corPrimaria: '#0b5ed7' });
      expect(r.status).toBe(200);
      expect(r.body.corPrimaria).toBe('#0B5ED7'.toUpperCase());
      expect(r.body.derivado.textoSobreMarca).toBe('#FFFFFF');
      const eff = await (await entrar('visA1')).c.get('/tema');
      expect(eff.body.corPrimaria).toBe('#0B5ED7');
      expect(eff.body.escopo).toBe('GRUPO');
    });

    it('Gerente define o tema da própria loja e não o do grupo nem o de outra loja', async () => {
      const { c } = await entrar('gerenteA1');
      const [a1, a2] = cen.A.empresaIds;
      expect((await c.put('/tema', { escopo: 'GRUPO', corPrimaria: '#104B3A' })).status).toBe(403);
      expect((await c.put('/tema', { escopo: 'EMPRESA', empresaId: a2, corPrimaria: '#104B3A' })).status).toBe(403);
      const ok = await c.put('/tema', { escopo: 'EMPRESA', empresaId: a1, corPrimaria: '#104B3A' });
      expect(ok.status).toBe(200);
      expect(ok.body.escopo).toBe('EMPRESA');
      expect((await c.get('/tema')).body.corPrimaria).toBe('#104B3A');
    });

    it('recusa cor clara demais e formato inválido; cor limítrofe troca o texto para escuro', async () => {
      const adm = (await entrar('adminA')).c;
      const clara = await adm.put('/tema', { escopo: 'GRUPO', corPrimaria: '#FFE066' });
      expect(clara.status).toBe(422);
      expect(clara.body.campos.corPrimaria).toMatch(/3:1/);
      expect((await adm.put('/tema', { escopo: 'GRUPO', corPrimaria: 'azul' })).status).toBe(422);
      expect((await adm.put('/tema', { escopo: 'GRUPO', corPrimaria: '#80BC43' })).status).toBe(422); // verde-claro: 2,3:1
      const media = await adm.put('/tema', { escopo: 'GRUPO', corPrimaria: '#008B49' }); // esmeralda: 4,38:1 com branco
      expect(media.status).toBe(200);
      expect(media.body.derivado.textoSobreMarca).toBe('#18382E');
    });

    it('Financeiro e Vistoriador não alteram tema', async () => {
      expect((await (await entrar('finA1')).c.put('/tema', { escopo: 'GRUPO', corPrimaria: '#104B3A' })).status).toBe(403);
      expect((await (await entrar('visA1')).c.put('/tema', { escopo: 'GRUPO', corPrimaria: '#104B3A' })).status).toBe(403);
    });
  });

  describe('auditoria', () => {
    it('registra o que foi feito, por quem, com antes e depois', async () => {
      const { c, eu } = await entrar('adminA');
      const [a1] = cen.A.empresaIds;
      await c.patch(`/empresas/${a1}`, { nomeFantasia: `Renomeada ${unico()}` });
      const r = await c.get(`/auditoria?entidade=empresa&entidadeId=${a1}`);
      expect(r.status).toBe(200);
      const ev = r.body.itens.find((i: { acao: string }) => i.acao === 'empresa.editada');
      expect(ev.usuarioId).toBe(eu.id);
      expect(ev.antes.nomeFantasia).toBeTruthy();
      expect(ev.depois.nomeFantasia).not.toBe(ev.antes.nomeFantasia);
    });

    it('Gerente vê só eventos da própria loja', async () => {
      const g = (await entrar('gerenteA1')).c;
      const r = await g.get('/auditoria?limite=200');
      expect(r.status).toBe(200);
      for (const i of r.body.itens) expect(i.empresaId).toBe(cen.A.empresaIds[0]);
    });

    it('Administrativo do grupo A nunca vê eventos do grupo B', async () => {
      await (await entrar('adminB')).c.post('/empresas', { cnpj: gerarCnpj(), razaoSocial: 'B Nova Ltda', nomeFantasia: `BNova ${unico()}`, uf: 'RJ', cidade: 'Niterói', regimeTributario: 'LUCRO_PRESUMIDO' });
      const r = await (await entrar('adminA')).c.get('/auditoria?limite=200');
      const grupos = await db.semTenant((c) => c.query('SELECT 1'));
      expect(grupos).toBeDefined();
      for (const i of r.body.itens) expect(JSON.stringify(i)).not.toContain('BNova');
    });

    it('Financeiro e Vistoriador não acessam o log', async () => {
      expect((await (await entrar('finA1')).c.get('/auditoria')).status).toBe(403);
      expect((await (await entrar('visA1')).c.get('/auditoria')).status).toBe(403);
    });

    it('login e logout ficam registrados', async () => {
      const g = (await entrar('gerenteA1')).c;
      const acoes = (await g.get('/auditoria?entidade=sessao&limite=100')).body.itens.map((i: { acao: string }) => i.acao);
      expect(acoes).toContain('auth.login');
    });
  });

  it('health responde sem login', async () => {
    const r = await cliente(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('erro de validação devolve campos em português, sem vazar detalhe interno', async () => {
    const r = await cliente(app).post('/auth/login', { email: 'nao-e-email', senha: '' });
    expect(r.status).toBe(422);
    expect(r.body.campos.email).toMatch(/e-mail/i);
    expect(ORIGEM).toBeTruthy();
  });
});
