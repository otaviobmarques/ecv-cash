import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { carregarEnv } from '../src/config/env';
import { configurar } from '../src/configurar';
import { DbService } from '../src/db/db.service';
import { criarGrupoCompleto } from '../src/db/seed-lib';

export const ORIGEM = 'http://app.test';
export const SENHA = 'Senha-de-teste-1';

export async function subirApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication();
  configurar(app, carregarEnv());
  await app.init();
  return { app, db: app.get(DbService) };
}

/** CNPJ válido aleatório (dígitos verificadores calculados). */
export function gerarCnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const dv = (d: number[], pesos: number[]) => {
    const r = d.reduce((a, n, i) => a + n * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join('');
}

export const unico = () => randomBytes(4).toString('hex');

/** Cliente HTTP que guarda o cookie de sessão. */
export function cliente(app: INestApplication) {
  const agent = request.agent(app.getHttpServer());
  return {
    agent,
    login: (email: string, senha = SENHA) => agent.post('/auth/login').set('Origin', ORIGEM).send({ email, senha }),
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('Origin', ORIGEM).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set('Origin', ORIGEM).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set('Origin', ORIGEM).send(body ?? {}),
  };
}

/** Dois grupos de teste. A tem duas lojas e todos os perfis; B tem uma loja e um administrativo. */
export async function criarCenario(db: DbService) {
  const s = unico();
  const mail = (n: string) => `${n}.${s}@teste.local`;
  const A = await criarGrupoCompleto(db, {
    nome: `Grupo A ${s}`,
    empresas: [{ nome: `A1 ${s}`, cnpj: gerarCnpj() }, { nome: `A2 ${s}`, cnpj: gerarCnpj() }],
    usuarios: [
      { nome: 'Admin A', email: mail('adminA'), senha: SENHA, perfil: 'ADMINISTRATIVO' },
      { nome: 'Gerente A1', email: mail('gerenteA1'), senha: SENHA, perfil: 'GERENTE', lojas: [0] },
      { nome: 'Financeiro A1', email: mail('finA1'), senha: SENHA, perfil: 'FINANCEIRO', lojas: [0] },
      { nome: 'Vistoriador A1', email: mail('visA1'), senha: SENHA, perfil: 'VISTORIADOR', lojas: [0] },
      { nome: 'Gerente A2', email: mail('gerenteA2'), senha: SENHA, perfil: 'GERENTE', lojas: [1] },
    ],
  });
  const B = await criarGrupoCompleto(db, {
    nome: `Grupo B ${s}`,
    empresas: [{ nome: `B1 ${s}`, cnpj: gerarCnpj() }],
    usuarios: [{ nome: 'Admin B', email: mail('adminB'), senha: SENHA, perfil: 'ADMINISTRATIVO' }],
  });
  return { s, mail, A, B };
}
