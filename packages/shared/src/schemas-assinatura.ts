import { z } from 'zod';
import { dataIso } from './schemas-caixa';
import { diasEntre } from './juros';

const centavos = z.number().int('Use centavos inteiros.').min(0, 'Não pode ser negativo.').max(100_000_000_00);

export const FORMAS_PAGAMENTO_SAAS = ['PIX', 'TRANSFERENCIA', 'BOLETO', 'CARTAO', 'OUTRO'] as const;
export const ROTULO_FORMA_SAAS: Record<(typeof FORMAS_PAGAMENTO_SAAS)[number], string> = {
  PIX: 'PIX', TRANSFERENCIA: 'Transferência', BOLETO: 'Boleto (emitido fora)', CARTAO: 'Cartão', OUTRO: 'Outra forma',
};

export const planoSaasSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao plano.').max(80),
  descricao: z.string().trim().max(300).optional(),
  valorBaseCentavos: centavos,
  empresasIncluidas: z.number().int().min(1, 'Ao menos 1 empresa.').max(500),
  valorEmpresaAdicionalCentavos: centavos,
});
export const planoSaasEdicaoSchema = planoSaasSchema.partial().extend({ ativo: z.boolean().optional() });

const motivo = z.string().trim().min(10, 'Explique o motivo em ao menos 10 caracteres.').max(300);

/** Contrato do grupo. Os valores vêm do plano, mas podem ser combinados (preço negociado); ficam gravados no contrato. */
export const assinaturaSaasSchema = z.object({
  planoId: z.string().uuid('Escolha o plano.'),
  valorBaseCentavos: centavos.optional(),
  empresasIncluidas: z.number().int().min(1).max(500).optional(),
  valorEmpresaAdicionalCentavos: centavos.optional(),
  descontoBp: z.number().int().min(0).max(10000).default(0),
  diaVencimento: z.number().int().min(1, 'Dia de 1 a 28.').max(28, 'Dia de 1 a 28.'),
  inicio: dataIso,
  testeAte: dataIso.optional(),
  carenciaDias: z.number().int().min(0).max(90).default(15),
  suspendeEmAtraso: z.boolean().default(false),
});
export const assinaturaSaasEdicaoSchema = assinaturaSaasSchema.partial().extend({ motivo });

export const cancelarAssinaturaSchema = z.object({ motivo });
export const cancelarCobrancaSaasSchema = z.object({ motivo });
export const baixarCobrancaSaasSchema = z.object({
  pagoEm: dataIso,
  forma: z.enum(FORMAS_PAGAMENTO_SAAS),
  referencia: z.string().trim().max(120).optional(),
});

export interface ParametrosMensalidade {
  valorBaseCentavos: number;
  empresasIncluidas: number;
  valorEmpresaAdicionalCentavos: number;
  descontoBp: number;
  /** empresas ativas do grupo na competência */
  empresas: number;
}

/** Mensalidade = base + empresas além das incluídas × adicional, menos o desconto (pontos-base, arredondado). */
export function calcularMensalidade(p: ParametrosMensalidade) {
  const extras = Math.max(0, p.empresas - p.empresasIncluidas);
  const bruto = p.valorBaseCentavos + extras * p.valorEmpresaAdicionalCentavos;
  const desconto = Math.round((bruto * p.descontoBp) / 10000);
  return { empresasCobradas: p.empresas, extras, brutoCentavos: bruto, descontoCentavos: desconto, valorCentavos: bruto - desconto };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Primeiro dia do mês de uma data AAAA-MM-DD. */
export const primeiroDiaDoMes = (data: string) => `${data.slice(0, 7)}-01`;
export function somarMeses(competencia: string, meses: number): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const t = a * 12 + (m - 1) + meses;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`;
}
export const vencimentoDaCompetencia = (competencia: string, dia: number) => `${competencia.slice(0, 8)}${pad(dia)}`;

/**
 * Competências que já deveriam existir em `hoje`: a mensalidade nasce `antecedenciaDias` antes do vencimento.
 * Só cobra vencimentos a partir do início do contrato e depois do fim do teste.
 */
export function competenciasDevidas(a: { inicio: string; testeAte?: string | null; diaVencimento: number }, hoje: string, antecedenciaDias = 10): { competencia: string; vencimento: string }[] {
  const saida: { competencia: string; vencimento: string }[] = [];
  for (let c = primeiroDiaDoMes(a.inicio), n = 0; n < 600; c = somarMeses(c, 1), n++) {
    const v = vencimentoDaCompetencia(c, a.diaVencimento);
    if (diasEntre(hoje, v) > antecedenciaDias) break;
    if (v < a.inicio || (a.testeAte && v <= a.testeAte)) continue;
    saida.push({ competencia: c, vencimento: v });
  }
  return saida;
}
