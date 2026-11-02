export type TipoColuna = 'texto' | 'data' | 'dinheiro' | 'inteiro' | 'percentual';
export interface ColunaRelatorio { chave: string; rotulo: string; tipo: TipoColuna }

const virgula = (n: number) => n.toFixed(2).replace('.', ',');

/** Valor como aparece no CSV: dinheiro com vírgula (R$ 1.234,56 vira 1234,56), data dd/mm/aaaa. */
export function valorCsv(v: unknown, tipo: TipoColuna): string {
  if (v === null || v === undefined || v === '') return '';
  if (tipo === 'dinheiro') return virgula(Number(v) / 100);
  if (tipo === 'percentual') return virgula(Number(v) / 100);
  if (tipo === 'data') return String(v).slice(0, 10).split('-').reverse().join('/');
  return String(v);
}

/**
 * CSV que o Excel brasileiro abre direto: separador ponto e vírgula, BOM UTF-8, números com vírgula.
 * Células que começam com = + - @ ganham um apóstrofo, para não virarem fórmula (injeção em planilha).
 */
export function paraCsv(colunas: ColunaRelatorio[], linhas: Record<string, unknown>[], totais?: Record<string, unknown> | null): string {
  const celula = (texto: string, texto_: boolean) => {
    let t = texto;
    if (texto_ && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const cab = colunas.map((c) => celula(c.rotulo, true)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(valorCsv(l[c.chave], c.tipo), c.tipo === 'texto')).join(';'));
  if (totais) corpo.push(colunas.map((c, i) => (i === 0 ? 'Total' : celula(valorCsv(totais[c.chave], c.tipo), false))).join(';'));
  return `﻿${[cab, ...corpo].join('\r\n')}\r\n`;
}
