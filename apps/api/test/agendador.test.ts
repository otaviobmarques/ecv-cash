import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { subirApp } from './helpers';

const SEGREDO = 'segredo-do-cron-de-teste-123456';

describe('rotina diária pelo Vercel Cron', () => {
  let app: INestApplication;
  beforeAll(async () => { process.env.CRON_SECRET = SEGREDO; ({ app } = await subirApp()); });
  afterAll(async () => { delete process.env.CRON_SECRET; await app.close(); });

  it('recusa sem o segredo ou com segredo errado', async () => {
    expect((await request(app.getHttpServer()).get('/interno/agendador')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/interno/agendador').set('Authorization', 'Bearer errado')).status).toBe(401);
  });

  it('roda com o segredo certo e pode rodar de novo no mesmo dia', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await request(app.getHttpServer()).get('/interno/agendador').set('Authorization', `Bearer ${SEGREDO}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ assinaturasOk: true, reguaOk: true });
    }
  });
});
