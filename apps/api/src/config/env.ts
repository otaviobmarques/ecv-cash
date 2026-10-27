import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ORIGENS_PERMITIDAS: z.string().default('http://localhost:5173'),
  SESSAO_HORAS: z.coerce.number().int().positive().default(12),
  /** só em dev e teste: devolve o link de convite na resposta, já que ainda não há envio de e-mail */
  EXPOR_CONVITE: z.enum(['true', 'false']).default('false'),
  URL_APP: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof schema>;
export const ENV = Symbol('ENV');
export const carregarEnv = (origem: NodeJS.ProcessEnv = process.env): Env => schema.parse(origem);
