import { z } from 'zod';
import { dataIso, motivoCurto } from './schemas-caixa';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);

export const periodoFaturaSchema = z.object({ periodoIni: dataIso, periodoFim: dataIso }).refine((p) => p.periodoFim >= p.periodoIni, { message: 'O fim do período não pode ser antes do início.', path: ['periodoFim'] });

export const previaFaturasSchema = z.object({ periodoIni: dataIso, periodoFim: dataIso, clienteId: z.string().uuid().optional() });

export const gerarFaturasSchema = z.object({
  periodoIni: dataIso, periodoFim: dataIso,
  clienteIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos um cliente.').max(300),
  emissao: dataIso.optional(),
  /** só para forçar um vencimento; sem informar vale emissão + prazo do cliente */
  vencimento: dataIso.optional(),
}).refine((p) => p.periodoFim >= p.periodoIni, { message: 'O fim do período não pode ser antes do início.', path: ['periodoFim'] });

export const baixaFaturaSchema = z.object({
  data: dataIso.optional(),
  /** quanto do valor da fatura (sem multa e juros) está sendo recebido; sem informar, quita tudo */
  principalCentavos: z.number().int().min(1).max(100_000_000_00).optional(),
  contaId: z.string().uuid('Escolha a conta em que o dinheiro entrou.').optional(),
  formaPagamentoId: vazio(z.string().uuid().optional()),
  perdoarEncargos: z.boolean().optional(),
  motivo: vazio(motivoCurto.optional()),
});

export const editarFaturaSchema = z.object({
  numeroNf: z.union([z.string().trim().min(1).max(40), z.null()]).optional(),
  numeroBoleto: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
  observacao: z.union([z.string().trim().max(500), z.null()]).optional(),
});

export const filtroFaturasSchema = z.object({
  situacao: z.enum(['abertas', 'vencidas', 'pagas', 'canceladas', 'todas']).default('abertas'),
  clienteId: z.string().uuid().optional(),
  de: dataIso.optional(), ate: dataIso.optional(),
  limite: z.coerce.number().int().min(1).max(200).default(100),
  pagina: z.coerce.number().int().min(0).default(0),
});
