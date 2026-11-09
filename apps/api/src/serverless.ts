import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import { AppModule } from './app.module';
import { carregarEnv } from './config/env';
import { configurar } from './configurar';

/**
 * Entrada da API na Vercel (Function). A aplicação Nest é criada uma vez por instância e reaproveitada
 * entre requisições. O agendador interno fica desligado aqui: quem dispara a rotina diária é o Vercel Cron.
 */
let pronto: Promise<Express> | undefined;

async function criar(): Promise<Express> {
  process.env.AGENDADOR = 'false';
  const env = carregarEnv();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  configurar(app, env);
  await app.init();
  return app.getHttpAdapter().getInstance() as Express;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  pronto ??= criar().catch((e) => { pronto = undefined; throw e; });
  const servidor = await pronto;
  servidor(req as never, res as never);
}
