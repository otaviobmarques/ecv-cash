import type { z, ZodTypeAny } from 'zod';

/** Valida com o mesmo schema da API e devolve as mensagens por campo. */
export function checar<T extends ZodTypeAny>(schema: T, dados: unknown): { dados: z.output<T>; erros: null } | { dados: null; erros: Record<string, string> } {
  const r = schema.safeParse(dados);
  if (r.success) return { dados: r.data, erros: null };
  const erros: Record<string, string> = {};
  for (const i of r.error.issues) erros[i.path.join('.') || '_'] ??= i.message;
  return { dados: null, erros };
}

export const camposDoErro = (e: unknown): Record<string, string> => (e as { campos?: Record<string, string> })?.campos ?? {};
export const mensagemDoErro = (e: unknown) => (e as Error)?.message ?? 'Algo deu errado. Tente de novo.';

export { CampoDinheiro, CampoPercentual } from '@ecv/ui';

export const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const pct = (bp: number | null | undefined) => (bp == null ? '—' : `${(bp / 100).toFixed(2).replace('.', ',')}%`);

/** 1 fatura, 2 faturas. */
export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
