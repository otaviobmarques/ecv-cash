import { z } from 'zod';
import { dataIso, motivoCurto } from './schemas-caixa';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const centavos = z.number().int('Use centavos inteiros.').min(1, 'Informe um valor maior que zero.').max(100_000_000_00);
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o mês no formato AAAA-MM.');

const camposTitulo = {
  fornecedorId: vazio(z.string().uuid().optional()),
  beneficiario: vazio(z.string().trim().min(2).max(120).optional()),
  descricao: z.string().trim().min(2, 'Descreva a despesa.').max(200),
  planoContaId: vazio(z.string().uuid().optional()),
  competencia: vazio(mes.optional()),
  vencimento: dataIso,
  valorCentavos: centavos,
  numeroDocumento: vazio(z.string().trim().max(60).optional()),
  observacao: vazio(z.string().trim().max(500).optional()),
  anexoId: vazio(z.string().uuid().optional()),
};

export const tituloPagarSchema = z.object({ ...camposTitulo, rascunho: z.boolean().optional() })
  .refine((d) => d.fornecedorId || d.beneficiario, { message: 'Escolha o fornecedor ou informe o favorecido.', path: ['fornecedorId'] });

export const editarTituloPagarSchema = z.object({
  fornecedorId: z.union([z.string().uuid(), z.null()]).optional(),
  beneficiario: z.union([z.string().trim().min(2).max(120), z.null()]).optional(),
  descricao: camposTitulo.descricao.optional(),
  planoContaId: z.union([z.string().uuid(), z.null()]).optional(),
  competencia: mes.optional(),
  vencimento: dataIso.optional(),
  valorCentavos: centavos.optional(),
  numeroDocumento: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
  observacao: z.union([z.string().trim().max(500), z.null()]).optional(),
  anexoId: z.union([z.string().uuid(), z.null()]).optional(),
});

export const pagamentoPagarSchema = z.object({
  data: dataIso.optional(),
  principalCentavos: centavos.optional(),
  jurosCentavos: z.number().int().min(0).max(100_000_000_00).optional(),
  multaCentavos: z.number().int().min(0).max(100_000_000_00).optional(),
  descontoCentavos: z.number().int().min(0).max(100_000_000_00).optional(),
  contaId: z.string().uuid('Escolha a conta de onde saiu o dinheiro.'),
  comprovanteId: vazio(z.string().uuid().optional()),
  motivo: vazio(motivoCurto.optional()),
});

export const recorrenciaSchema = z.object({
  fornecedorId: vazio(z.string().uuid().optional()),
  descricao: z.string().trim().min(2, 'Descreva a despesa.').max(160),
  planoContaId: vazio(z.string().uuid().optional()),
  valorCentavos: centavos,
  frequencia: z.enum(['SEMANAL', 'QUINZENAL', 'MENSAL', 'ANUAL']),
  dia: z.number().int().min(0).max(31),
  inicio: dataIso,
  fim: vazio(dataIso.optional()),
}).superRefine((d, ctx) => {
  if ((d.frequencia === 'MENSAL' || d.frequencia === 'ANUAL') && (d.dia < 1 || d.dia > 31)) ctx.addIssue({ code: 'custom', path: ['dia'], message: 'Escolha o dia do mês, de 1 a 31.' });
  if ((d.frequencia === 'SEMANAL' || d.frequencia === 'QUINZENAL') && d.dia > 6) ctx.addIssue({ code: 'custom', path: ['dia'], message: 'Escolha o dia da semana.' });
  if (d.fim && d.fim < d.inicio) ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O fim não pode ser antes do início.' });
});

/** Despesa dividida entre lojas do grupo (só o Administrativo). Os pesos somam 100% (10000 pontos-base). */
export const rateioSchema = z.object({
  fornecedorId: vazio(z.string().uuid().optional()),
  beneficiario: vazio(z.string().trim().min(2).max(120).optional()),
  descricao: z.string().trim().min(2, 'Descreva a despesa.').max(200),
  planoContaId: vazio(z.string().uuid().optional()),
  competencia: vazio(mes.optional()),
  vencimento: dataIso,
  valorTotalCentavos: centavos,
  itens: z.array(z.object({ empresaId: z.string().uuid(), pesoBp: z.number().int().min(1).max(10000) })).min(2, 'Escolha ao menos duas lojas.').max(100),
}).refine((d) => d.fornecedorId || d.beneficiario, { message: 'Escolha o fornecedor ou informe o favorecido.', path: ['fornecedorId'] })
  .refine((d) => d.itens.reduce((s, i) => s + i.pesoBp, 0) === 10000, { message: 'As porcentagens precisam somar 100%.', path: ['itens'] })
  .refine((d) => new Set(d.itens.map((i) => i.empresaId)).size === d.itens.length, { message: 'Cada loja só pode aparecer uma vez.', path: ['itens'] });

export const apurarCustosSchema = z.object({ de: dataIso, ate: dataIso, vencimento: dataIso.optional() })
  .refine((d) => d.ate >= d.de, { message: 'O fim não pode ser antes do início.', path: ['ate'] });

export const filtroPagarSchema = z.object({
  situacao: z.enum(['abertos', 'vencidos', 'pendentes', 'rascunhos', 'pagos', 'cancelados', 'todos']).default('abertos'),
  fornecedorId: z.string().uuid().optional(),
  origem: z.enum(['MANUAL', 'RECORRENCIA', 'ROYALTY', 'COMISSAO', 'CUSTO_LAUDO', 'RATEIO']).optional(),
  vencDe: dataIso.optional(), vencAte: dataIso.optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
  pagina: z.coerce.number().int().min(0).default(0),
});

export const rejeitarPagarSchema = z.object({ motivo: motivoCurto });
