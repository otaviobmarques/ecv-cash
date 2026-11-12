import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { exigirOrigemPermitida, origemPermitida } from './common/origem';
import { FiltroDeErros } from './common/filtro-erros';
import type { Env } from './config/env';

/** Configuração comum à aplicação real e aos testes. */
export function configurar(app: INestApplication, env: Env) {
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env.TRUST_PROXY_SALTOS);
  const origens = env.ORIGENS_PERMITIDAS.split(',').map((o) => o.trim());
  const permitida = origemPermitida(origens);
  app.enableCors({ origin: (o, cb) => cb(null, !o || permitida(o)), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'] });
  app.use(helmet());
  app.use(cookieParser());
  app.use(exigirOrigemPermitida(origens));
  app.useGlobalFilters(new FiltroDeErros());
  return app;
}
