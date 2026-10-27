import { z } from 'zod';
import { PERFIS } from './perfis';
import { cnpjValido, normalizarCnpj } from './documentos';
import { ehHex } from './contraste';

const email = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(200);

export const loginSchema = z.object({
  email,
  senha: z.string().min(1, 'Informe a senha.').max(200),
});

export const senhaNova = z
  .string()
  .min(10, 'Use ao menos 10 caracteres.')
  .max(200)
  .refine((s) => /[a-zA-Z]/.test(s) && /\d/.test(s), 'Use letras e números.');

export const aceitarConviteSchema = z.object({ token: z.string().min(20).max(200), senha: senhaNova });

export const criarEmpresaSchema = z.object({
  cnpj: z.string().transform(normalizarCnpj).refine(cnpjValido, 'CNPJ inválido.'),
  razaoSocial: z.string().trim().min(3).max(200),
  nomeFantasia: z.string().trim().min(2).max(120),
  uf: z.string().trim().length(2).toUpperCase(),
  cidade: z.string().trim().min(2).max(80),
  regimeTributario: z.enum(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']),
  emailFinanceiro: email.optional(),
});

export const criarUsuarioSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email,
  perfil: z.enum(PERFIS),
  /** obrigatório para Gerente, Financeiro e Vistoriador; ignorado para Administrativo (rede) */
  empresaIds: z.array(z.string().uuid()).default([]),
});

export const escolherEmpresaSchema = z.object({ empresaId: z.string().uuid() });

const hex = z.string().refine(ehHex, 'Use uma cor no formato #RRGGBB.');
export const temaSchema = z.object({
  escopo: z.enum(['GRUPO', 'EMPRESA']),
  empresaId: z.string().uuid().optional(),
  corPrimaria: hex,
  corSecundaria: hex.optional(),
  corDestaque: hex.optional(),
});

export type CriarEmpresa = z.infer<typeof criarEmpresaSchema>;
export type CriarUsuario = z.infer<typeof criarUsuarioSchema>;
export type TemaEntrada = z.infer<typeof temaSchema>;
