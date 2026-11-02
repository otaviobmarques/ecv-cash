import { z } from 'zod';
import { dataIso, motivoCurto } from './schemas-caixa';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const centavos = z.number().int('Use centavos inteiros.').min(1, 'Informe um valor maior que zero.').max(100_000_000_00);

export const baixaSchema = z.object({
  data: dataIso.optional(),
  /** quanto do valor do título está sendo recebido; sem informar, quita o saldo */
  principalCentavos: centavos.optional(),
  contaId: z.string().uuid('Escolha a conta em que o dinheiro entrou.').optional(),
  formaPagamentoId: vazio(z.string().uuid().optional()),
  perdoarEncargos: z.boolean().optional(),
  perdaoCentavos: z.number().int().min(0).max(100_000_000_00).optional(),
  motivo: vazio(motivoCurto.optional()),
});

export const loteBaixaSchema = z.object({
  itens: z.array(z.object({ tituloId: z.string().uuid(), principalCentavos: centavos.optional() })).min(1, 'Escolha ao menos um título.').max(200, 'No máximo 200 títulos por vez.'),
  data: dataIso.optional(),
  contaId: z.string().uuid('Escolha a conta em que o dinheiro entrou.').optional(),
  formaPagamentoId: vazio(z.string().uuid().optional()),
  perdoarEncargos: z.boolean().optional(),
  motivo: vazio(motivoCurto.optional()),
});

export const filtroReceberSchema = z.object({
  situacao: z.enum(['abertos', 'vencidos', 'quitados', 'cancelados', 'todos']).default('abertos'),
  clienteId: z.string().uuid().optional(),
  formaPagamentoId: z.string().uuid().optional(),
  placa: z.string().trim().max(8).optional(),
  vencDe: dataIso.optional(),
  vencAte: dataIso.optional(),
  semFatura: z.enum(['1', 'true']).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
  pagina: z.coerce.number().int().min(0).default(0),
});

export const simularBaixaSchema = z.object({ data: dataIso.optional(), principalCentavos: z.coerce.number().int().min(1).optional() });

export const configFinanceiraSchema = z.object({
  perdaoLimiteCentavos: z.number().int().min(0).max(1_000_000_00).optional(),
  aprovacaoPagarObrigatoria: z.boolean().optional(),
  financeiroAprovaPagar: z.boolean().optional(),
  financeiroVeDre: z.boolean().optional(),
});
