import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ORIGENS_PERMITIDAS: z.string().default('http://localhost:5173,http://localhost:5174'),
  SESSAO_HORAS: z.coerce.number().int().positive().default(12),
  /** Enquanto não houver envio de e-mail (Fase 2), quem cria o convite recebe o link para entregar. Desligar quando o e-mail entrar. */
  EXPOR_CONVITE: z.enum(['true', 'false']).default('true'),
  URL_APP: z.string().default('http://localhost:5173'),
  URL_BACKOFFICE: z.string().default('http://localhost:5174'),
  /** Quantos proxies existem na frente da API (para enxergar o IP real de quem acessa). Com Traefik e Caddy em fila, são 2. */
  TRUST_PROXY_SALTOS: z.coerce.number().int().min(0).max(5).default(1),
  /** 32 bytes em base64. Cifra segredos de 2FA e assina tickets. Obrigatória em produção. */
  CHAVE_SEGREDOS: z.string().optional(),
});

const comRegras = schema.superRefine((e, ctx) => {
  if (e.NODE_ENV === 'production' && !e.CHAVE_SEGREDOS) ctx.addIssue({ code: 'custom', message: 'Defina CHAVE_SEGREDOS em produção.', path: ['CHAVE_SEGREDOS'] });
});

export type Env = z.infer<typeof schema>;
export const ENV = Symbol('ENV');
/** Chave só para desenvolvimento e testes. Nunca vale em produção (a validação acima exige a variável). */
export const CHAVE_DEV = Buffer.alloc(32, 7).toString('base64');
export const carregarEnv = (origem: NodeJS.ProcessEnv = process.env): Env => comRegras.parse(origem);
