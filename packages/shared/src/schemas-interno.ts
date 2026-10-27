import { z } from 'zod';
import { criarEmpresaSchema } from './schemas';

const email = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(200);

export const loginInternoSchema = z.object({ email, senha: z.string().min(1, 'Informe a senha.').max(200) });
export const mfaInternoSchema = z.object({ ticket: z.string().min(20).max(2000), codigo: z.string().regex(/^\d{6}$/, 'O código tem 6 números.') });

export const criarGrupoSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do grupo.').max(120),
  empresa: criarEmpresaSchema,
  administrativo: z.object({ nome: z.string().trim().min(2).max(120), email }),
});

export const statusGrupoSchema = z.object({
  status: z.enum(['ATIVO', 'SUSPENSO']),
  motivo: z.string().trim().min(10, 'Explique o motivo em ao menos 10 caracteres.').max(300),
});

export const entrarComoSchema = z.object({ motivo: z.string().trim().min(10, 'Explique o motivo em ao menos 10 caracteres.').max(300) });
export const trocarTicketSuporteSchema = z.object({ ticket: z.string().min(20).max(200) });
