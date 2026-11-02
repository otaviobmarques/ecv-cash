import { z } from 'zod';
import { dataIso } from './schemas-caixa';

const vazio = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o mês no formato AAAA-MM.');

export const regraRepasseSchema = z.object({
  fornecedorId: z.string().uuid('Escolha o franqueador ou fornecedor que recebe.'),
  nome: z.string().trim().min(2, 'Dê um nome à regra (ex.: Royalties).').max(80),
  tipo: z.enum(['PERCENTUAL', 'VALOR_FIXO']),
  percentualBp: z.number().int().min(1, 'Informe o percentual.').max(10000).optional(),
  valorCentavos: z.number().int().min(1, 'Informe o valor.').max(1_000_000_000).optional(),
  base: z.enum(['BRUTO', 'LIQUIDO', 'RECEBIDO']).optional(),
  vencimentoDia: z.number().int().min(1).max(31).default(10),
  planoContaId: vazio(z.string().uuid().optional()),
  vigenciaIni: dataIso,
  vigenciaFim: vazio(dataIso.optional()),
}).superRefine((r, ctx) => {
  if (r.tipo === 'PERCENTUAL') {
    if (r.percentualBp === undefined) ctx.addIssue({ code: 'custom', path: ['percentualBp'], message: 'Informe o percentual.' });
    if (!r.base) ctx.addIssue({ code: 'custom', path: ['base'], message: 'Escolha sobre o que o percentual incide.' });
  } else if (r.valorCentavos === undefined) ctx.addIssue({ code: 'custom', path: ['valorCentavos'], message: 'Informe o valor.' });
  if (r.vigenciaFim && r.vigenciaFim < r.vigenciaIni) ctx.addIssue({ code: 'custom', path: ['vigenciaFim'], message: 'O fim não pode ser antes do início.' });
});
export const editarRegraRepasseSchema = z.object({ ativa: z.boolean().optional(), vigenciaFim: z.union([dataIso, z.null()]).optional() });
export const apurarRepasseSchema = z.object({ mes, regraId: z.string().uuid().optional() });

export const aliquotaSchema = z.object({
  nome: z.enum(['ISS', 'PIS', 'COFINS', 'SIMPLES_NACIONAL', 'OUTRO']),
  descricao: vazio(z.string().trim().min(2).max(60).optional()),
  percentualBp: z.number().int().min(0, 'Informe o percentual.').max(10000),
  vigenciaIni: dataIso,
  vigenciaFim: vazio(dataIso.optional()),
}).superRefine((a, ctx) => {
  if (a.nome === 'OUTRO' && !a.descricao) ctx.addIssue({ code: 'custom', path: ['descricao'], message: 'Diga qual é o imposto.' });
  if (a.vigenciaFim && a.vigenciaFim < a.vigenciaIni) ctx.addIssue({ code: 'custom', path: ['vigenciaFim'], message: 'O fim não pode ser antes do início.' });
});
export const editarAliquotaSchema = z.object({ ativa: z.boolean().optional(), vigenciaFim: z.union([dataIso, z.null()]).optional() });
export const ROTULO_IMPOSTO = { ISS: 'ISS', PIS: 'PIS', COFINS: 'COFINS', SIMPLES_NACIONAL: 'Simples Nacional', OUTRO: 'Outro' } as const;

export const saldoManualSchema = z.object({
  planoContaId: z.string().uuid('Escolha a conta do plano.'),
  dataBase: dataIso,
  valorCentavos: z.number().int('Use centavos inteiros.').min(0, 'Informe o valor sem sinal: o tipo da conta já diz se é ativo ou passivo.').max(100_000_000_000_00),
  observacao: vazio(z.string().trim().max(300).optional()),
});
