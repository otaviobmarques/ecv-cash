import { z } from 'zod';
import { normalizarPlaca } from './documentos';
import { normalizarChassi } from './laudos';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.').refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida.');
const placa = z.string().transform((s, ctx) => {
  const p = normalizarPlaca(s);
  if (!p) ctx.addIssue({ code: 'custom', message: 'Placa inválida. Confira as letras e os números.' });
  return p ?? '';
});
const chassi = z.string().transform((s, ctx) => {
  const c = normalizarChassi(s);
  if (!c) ctx.addIssue({ code: 'custom', message: 'Chassi inválido: são 17 caracteres, sem as letras I, O e Q.' });
  return c ?? '';
});
const centavos = z.number().int('Use centavos inteiros.').max(100_000_00);
const motivo = z.string().trim().min(5, 'Explique o motivo em ao menos 5 caracteres.').max(300);

const camposLancamento = {
  placa,
  chassi: vazio(chassi.optional()),
  numeroLaudo: vazio(z.string().trim().max(40).optional()),
  dataLaudo: dataIso.optional(),
  clienteId: z.string().uuid('Escolha o cliente.'),
  servicoId: z.string().uuid('Escolha o serviço.'),
  formaPagamentoId: z.string().uuid('Escolha a forma de pagamento.'),
  /** só quem tem permissão informa; com preço na tabela é o valor cobrado no lugar da tabela */
  valorCobradoCentavos: centavos.min(0).optional(),
  /** obrigatório quando o cliente não tem preço cadastrado para o serviço */
  valorManualCentavos: centavos.min(1, 'Informe um valor maior que zero.').optional(),
  ajusteMotivo: vazio(motivo.optional()),
  observacao: vazio(z.string().trim().max(500).optional()),
};

export const laudoSchema = z.object({
  ...camposLancamento,
  vistoriadorId: vazio(z.string().uuid().optional()),
  confirmarDuplicidade: z.boolean().optional(),
  motivoDuplicidade: vazio(motivo.optional()),
});

export const itemLoteSchema = z.object({
  placa,
  clienteId: z.string().uuid('Escolha o cliente.'),
  servicoId: z.string().uuid('Escolha o serviço.'),
  formaPagamentoId: z.string().uuid('Escolha a forma de pagamento.'),
  numeroLaudo: vazio(z.string().trim().max(40).optional()),
  valorManualCentavos: centavos.min(1).optional(),
});

export const loteSchema = z.object({
  dataLaudo: dataIso.optional(),
  vistoriadorId: vazio(z.string().uuid().optional()),
  itens: z.array(z.unknown()).min(1, 'Preencha ao menos um laudo.').max(50, 'No máximo 50 laudos por vez.'),
});

export const editarLaudoSchema = z.object({
  placa: placa.optional(),
  chassi: z.union([chassi, z.null()]).optional(),
  numeroLaudo: z.union([z.string().trim().min(1).max(40), z.null()]).optional(),
  dataLaudo: dataIso.optional(),
  clienteId: z.string().uuid().optional(),
  servicoId: z.string().uuid().optional(),
  vistoriadorId: z.string().uuid().optional(),
  formaPagamentoId: z.string().uuid().optional(),
  valorCobradoCentavos: centavos.min(0).optional(),
  valorManualCentavos: centavos.min(1).optional(),
  ajusteMotivo: vazio(motivo.optional()),
  observacao: z.union([z.string().trim().max(500), z.null()]).optional(),
  confirmarDuplicidade: z.boolean().optional(),
  motivoDuplicidade: vazio(motivo.optional()),
});

export const motivoSchema = z.object({ motivo });
export const revisarLaudoSchema = z.object({ promoverPreco: z.boolean().default(false) });

export const filtroLaudosSchema = z.object({
  de: dataIso.optional(),
  ate: dataIso.optional(),
  placa: z.string().trim().max(8).optional(),
  clienteId: z.string().uuid().optional(),
  servicoId: z.string().uuid().optional(),
  vistoriadorId: z.string().uuid().optional(),
  status: z.enum(['ATIVO', 'CANCELADO']).optional(),
  revisar: z.enum(['1', 'true']).optional(),
  cancelamentoPedido: z.enum(['1', 'true']).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  antesDoNumero: z.coerce.number().int().positive().optional(),
});

export type LaudoEntrada = z.infer<typeof laudoSchema>;
export type ItemLote = z.infer<typeof itemLoteSchema>;
