import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { hashSenha } from '../src/auth/senha';
import { SENHA, cliente, subirApp, unico } from './helpers';

describe('backoffice com o 2FA desligado (BO_EXIGIR_2FA=false)', () => {
  let app: INestApplication; let db: DbService;
  beforeAll(async () => { process.env.BO_EXIGIR_2FA = 'false'; ({ app, db } = await subirApp()); });
  afterAll(async () => { delete process.env.BO_EXIGIR_2FA; await app.close(); });

  const criar = async () => {
    const email = `sem2fa.${unico()}@interno.local`;
    await db.semTenant(async (c) => c.query('INSERT INTO usuario_interno (nome, email, senha_hash, papel) VALUES ($1,$2,$3,$4)', ['Sem 2FA', email, await hashSenha(SENHA), 'PLATAFORMA']));
    return email;
  };

  it('a senha certa já abre a sessão, sem pedir código', async () => {
    const email = await criar(); const c = cliente(app);
    const r = await c.post('/backoffice/auth/login', { email, senha: SENHA });
    expect(r.status).toBe(200);
    expect(r.body.etapa).toBe('ENTROU');
    expect(r.body.interno).toMatchObject({ email, papel: 'PLATAFORMA' });
    expect(r.body.interno.permissoes.length).toBeGreaterThan(0);
    expect(r.body.ticket).toBeUndefined();
    const eu = await c.get('/backoffice/auth/eu');
    expect(eu.status).toBe(200);
    expect(eu.body.email).toBe(email);
  });

  it('a senha errada continua recusada', async () => {
    const email = await criar();
    const r = await cliente(app).post('/backoffice/auth/login', { email, senha: 'errada-errada-1' });
    expect(r.status).toBe(401);
  });
});
