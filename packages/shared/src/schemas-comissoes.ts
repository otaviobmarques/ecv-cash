import { z } from 'zod';
import { dataIso } from './schemas-caixa';
import { aplicarBp } from './dinheiro';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);

export const regraComissaoSchema = z.object({
  vistoriadorId: vazio(z.string().uuid().optional()),
  servicoId: vazio(z.string().uuid().optional()),
  tipo: z.enum(['PERCENTUAL', 'VALOR']),
  percentualBp: z.number().int().min(1, 'Informe o percentual.').max(10000).optional(),
  valorCentavos: z.number().int().min(1, 'Informe o valor.').max(10_000_000).optional(),
  devidaEm: z.enum(['EMISSAO', 'RECEBIMENTO']).default('EMISSAO'),
  vigenciaIni: dataIso,
  vigenciaFim: vazio(dataIso.optional()),
}).superRefine((r, ctx) => {
  if (r.tipo === 'PERCENTUAL' && r.percentualBp === undefined) ctx.addIssue({ code: 'custom', path: ['percentualBp'], message: 'Informe o percentual.' });
  if (r.tipo === 'VALOR' && r.valorCentavos === undefined) ctx.addIssue({ code: 'custom', path: ['valorCentavos'], message: 'Informe o valor.' });
  if (r.vigenciaFim && r.vigenciaFim < r.vigenciaIni) ctx.addIssue({ code: 'custom', path: ['vigenciaFim'], message: 'O fim não pode ser antes do início.' });
});
export const editarRegraComissaoSchema = z.object({ ativa: z.boolean().optional(), vigenciaFim: z.union([dataIso, z.null()]).optional() });

export const apuracaoComissaoSchema = z.object({ de: dataIso, ate: dataIso, vistoriadorId: z.string().uuid().optional() }).refine((d) => d.ate >= d.de, { message: 'O fim não pode ser antes do início.', path: ['ate'] });
export const fecharComissaoSchema = z.object({ de: dataIso, ate: dataIso, vistoriadorId: z.string().uuid().optional(), vencimento: dataIso.optional() }).refine((d) => d.ate >= d.de, { message: 'O fim não pode ser antes do início.', path: ['ate'] });

/** Comissão de um laudo: percentual do valor cobrado (arredondado ao centavo) ou valor fixo. */
export function calcularComissao(regra: { tipo: 'PERCENTUAL' | 'VALOR'; percentualBp?: number | null; valorCentavos?: number | null }, valorCobradoCentavos: number): number {
  if (regra.tipo === 'VALOR') return regra.valorCentavos ?? 0;
  return aplicarBp(valorCobradoCentavos, regra.percentualBp ?? 0);
}
