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
  /** Envio de e-mail. Sem SMTP_HOST nada é enviado: os pedidos ficam registrados como "sem configuração". */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_FROM: z.string().default('ECV Cash <nao-responda@localhost>'),
  /** Roda a régua de cobrança todo dia, na hora indicada (Brasília). Ligar em um único processo da API. */
  AGENDADOR: z.enum(['true', 'false']).default('false'),
  HORA_COBRANCA: z.coerce.number().int().min(0).max(23).default(8),
  /** Segredo do Vercel Cron: libera `GET /interno/agendador` com `Authorization: Bearer <CRON_SECRET>`. Sem ele, a rota fica fechada. */
  CRON_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
  /** Conexões por processo. Na Vercel cada instância é um processo: mantenha baixo e use o pooler do Supabase (modo transação). */
  PG_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Conta PIX da ECV Cash para receber as mensalidades (aparece em "Minha assinatura"). Sem chave, só o valor e o vencimento aparecem. */
  // o docker-compose manda "" quando a variável não está no .env: vazio vale como ausente
  ECV_PIX_TIPO: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['CNPJ', 'CPF', 'EMAIL', 'TELEFONE', 'ALEATORIA']).optional()),
  ECV_PIX_CHAVE: z.string().optional(),
  ECV_PIX_NOME: z.string().default('ECV CASH'),
  ECV_PIX_CIDADE: z.string().default('SAO PAULO'),
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
