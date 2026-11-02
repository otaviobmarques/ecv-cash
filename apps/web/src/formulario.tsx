import { useState } from 'react';
import type { z, ZodTypeAny } from 'zod';
import { formatarBRL, paraCentavos, percentualParaBp } from '@ecv/shared';
import { Campo } from '@ecv/ui';

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

/** Dinheiro digitado em reais ("1.234,56") que vira centavos inteiros. */
export function CampoDinheiro({ rotulo, centavos, onChange, erro, dica, obrigatorio }: { rotulo: string; centavos: number | null; onChange: (c: number | null) => void; erro?: string; dica?: string; obrigatorio?: boolean }) {
  const [texto, setTexto] = useState(centavos == null ? '' : formatarBRL(centavos).replace('R$ ', ''));
  return (
    <Campo rotulo={rotulo} inputMode="decimal" placeholder="0,00" value={texto} erro={erro} dica={dica} obrigatorio={obrigatorio}
      onChange={(e) => { setTexto(e.target.value); onChange(e.target.value.trim() === '' ? null : paraCentavos(e.target.value)); }}
      onBlur={() => { const c = paraCentavos(texto); if (c !== null) setTexto(formatarBRL(c).replace('R$ ', '')); }} />
  );
}

/** Percentual digitado ("2,00") que vira pontos-base (200). */
export function CampoPercentual({ rotulo, bp, onChange, erro, dica, obrigatorio }: { rotulo: string; bp: number | null; onChange: (b: number | null) => void; erro?: string; dica?: string; obrigatorio?: boolean }) {
  const [texto, setTexto] = useState(bp == null ? '' : (bp / 100).toFixed(2).replace('.', ','));
  return (
    <Campo rotulo={rotulo} inputMode="decimal" placeholder="0,00" value={texto} erro={erro} dica={dica} obrigatorio={obrigatorio}
      onChange={(e) => { setTexto(e.target.value); onChange(e.target.value.trim() === '' ? null : percentualParaBp(e.target.value)); }} />
  );
}

export const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const pct = (bp: number | null | undefined) => (bp == null ? '—' : `${(bp / 100).toFixed(2).replace('.', ',')}%`);

/** 1 fatura, 2 faturas. */
export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
