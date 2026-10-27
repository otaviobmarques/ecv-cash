import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { exigirOrigemPermitida } from './common/origem';
import { FiltroDeErros } from './common/filtro-erros';
import type { Env } from './config/env';

/** Configuração comum à aplicação real e aos testes. */
export function configurar(app: INestApplication, env: Env) {
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use(exigirOrigemPermitida(env.ORIGENS_PERMITIDAS.split(',').map((s) => s.trim())));
  app.useGlobalFilters(new FiltroDeErros());
  return app;
}
