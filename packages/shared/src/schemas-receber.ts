import { z } from 'zod';
import { dataIso, motivoCurto } from './schemas-caixa';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const centavos = z.number().int('Use centavos inteiros.').min(1, 'Informe um valor maior que zero.').max(100_000_000_00);

export const dadosChequeSchema = z.object({
  numero: z.string().trim().min(1, 'Informe o número do cheque.').max(20),
  banco: vazio(z.string().trim().max(60).optional()),
  emitente: z.string().trim().min(2, 'Informe quem emitiu o cheque.').max(120),
  bomPara: dataIso,
});

export const baixaSchema = z.object({
  data: dataIso.optional(),
  /** quanto do valor do título está sendo recebido; sem informar, quita o saldo */
  principalCentavos: centavos.optional(),
  contaId: z.string().uuid('Escolha a conta em que o dinheiro entrou.').optional(),
  formaPagamentoId: vazio(z.string().uuid().optional()),
  perdoarEncargos: z.boolean().optional(),
  perdaoCentavos: z.number().int().min(0).max(100_000_000_00).optional(),
  motivo: vazio(motivoCurto.optional()),
  /** obrigatório quando a forma de pagamento é cheque */
  cheque: dadosChequeSchema.optional(),
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

export const liquidarCartaoSchema = z.object({
  contaId: z.string().uuid('Escolha a conta em que a operadora depositou.'),
  data: dataIso.optional(),
  /** só quando o depósito veio diferente do previsto; a diferença fica registrada */
  liquidoRecebidoCentavos: z.number().int().min(1).max(100_000_000_00).optional(),
  motivo: vazio(motivoCurto.optional()),
});
export const liquidarLoteSchema = z.object({ ids: z.array(z.string().uuid()).min(1, 'Escolha ao menos uma venda.').max(300), contaId: z.string().uuid('Escolha a conta em que a operadora depositou.'), data: dataIso.optional() });
export const filtroCartaoSchema = z.object({
  situacao: z.enum(['previstas', 'atrasadas', 'liquidadas', 'canceladas', 'todas']).default('previstas'),
  formaId: z.string().uuid().optional(), de: dataIso.optional(), ate: dataIso.optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200), pagina: z.coerce.number().int().min(0).default(0),
});
export const filtroChequeSchema = z.object({
  situacao: z.enum(['receber', 'recebidos', 'depositados', 'compensados', 'devolvidos', 'todos']).default('receber'),
  de: dataIso.optional(), ate: dataIso.optional(), limite: z.coerce.number().int().min(1).max(500).default(200),
});
export const depositarChequeSchema = z.object({ contaId: z.string().uuid('Escolha a conta do depósito.'), data: dataIso.optional() });
export const compensarChequeSchema = z.object({ data: dataIso.optional() });
export const devolverChequeSchema = z.object({ data: dataIso.optional(), motivo: motivoCurto });
