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
import { Mailer, type MensagemEmail, type ResultadoEnvio } from '../src/mail/mailer';

/** Caixa de saída de mentira: guarda o que seria enviado e deixa o teste escolher se o envio dá certo, falha ou não está configurado. */
export class MailerFalso extends Mailer {
  configurado = true;
  modo: 'ok' | 'erro' | 'semConfiguracao' = 'ok';
  enviados: MensagemEmail[] = [];
  convites: { para: string; link: string }[] = [];
  async enviar(m: MensagemEmail): Promise<ResultadoEnvio> {
    if (this.modo === 'erro') return { ok: false, configurado: true, erro: 'O servidor de e-mail recusou ou não respondeu. Tente de novo mais tarde.' };
    if (this.modo === 'semConfiguracao') return { ok: false, configurado: false, erro: 'O envio de e-mail não está configurado neste ambiente.' };
    this.enviados.push(m); return { ok: true };
  }
  async enviarConvite(para: string, _nome: string, link: string) { this.convites.push({ para, link }); }
}

export const ORIGEM = 'http://app.test';
export const SENHA = 'Senha-de-teste-1';

export async function subirApp(opcoes: { mailer?: Mailer } = {}) {
  const construtor = Test.createTestingModule({ imports: [AppModule] });
  if (opcoes.mailer) construtor.overrideProvider(Mailer).useValue(opcoes.mailer);
  const mod = await construtor.compile();
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
