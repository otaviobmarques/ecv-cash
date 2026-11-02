import { z } from 'zod';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
export const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.').refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida.');
export const motivoCurto = z.string().trim().min(5, 'Explique o motivo em ao menos 5 caracteres.').max(300);
const centavosPositivo = z.number().int('Use centavos inteiros.').min(1, 'Informe um valor maior que zero.').max(100_000_000_00);

/** Entrada ou saída avulsa (tarifa bancária, sangria, aporte...). Positivo entra, negativo sai. */
export const ajusteCaixaSchema = z.object({
  contaId: z.string().uuid('Escolha a conta.'),
  data: dataIso.optional(),
  valorCentavos: z.number().int('Use centavos inteiros.').refine((v) => v !== 0, 'Informe um valor diferente de zero.').refine((v) => Math.abs(v) <= 100_000_000_00, 'Valor alto demais.'),
  descricao: z.string().trim().min(2, 'Descreva o lançamento.').max(200),
  planoContaId: vazio(z.string().uuid().optional()),
  motivo: motivoCurto,
});

export const transferenciaSchema = z.object({
  contaOrigemId: z.string().uuid('Escolha a conta de origem.'),
  contaDestinoId: z.string().uuid('Escolha a conta de destino.'),
  data: dataIso.optional(),
  valorCentavos: centavosPositivo,
  descricao: z.string().trim().min(2, 'Descreva a transferência.').max(200),
}).refine((d) => d.contaOrigemId !== d.contaDestinoId, { message: 'Origem e destino precisam ser contas diferentes.', path: ['contaDestinoId'] });

export const fecharDiaSchema = z.object({
  contaId: z.string().uuid('Escolha a conta.'),
  data: dataIso,
  saldoContadoCentavos: z.number().int('Use centavos inteiros.').min(-100_000_000_00).max(100_000_000_00),
  observacao: vazio(z.string().trim().max(300).optional()),
});

export const reabrirSchema = z.object({ motivo: motivoCurto });
export const fecharPeriodoSchema = z.object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o mês no formato AAAA-MM.') });
export const estornoSchema = z.object({ motivo: motivoCurto });
export const filtroExtratoSchema = z.object({ contaId: z.string().uuid(), de: dataIso.optional(), ate: dataIso.optional() });
