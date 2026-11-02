declare const TextDecoder: new (rotulo: string) => { decode(bytes: Uint8Array): string }; // existe no Node e no navegador

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

/** Lê o texto de um CSV (Excel brasileiro ou internacional): descobre o separador (; , ou tab), entende aspas e quebras de linha dentro de aspas. */
export function lerCsv(texto: string): { cabecalho: string[]; linhas: string[][]; separador: string } {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const conta = (s: string) => (primeira.match(new RegExp(`\\${s}`, 'g')) ?? []).length;
  const separador = [';', ',', '\t'].reduce((m, s) => (conta(s) > conta(m) ? s : m), ';');
  const linhas: string[][] = []; let campo = ''; let linha: string[] = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (aspas) {
      if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === separador) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.some((c) => c.trim() !== '')) linhas.push(linha); linha = []; }
    else campo += ch;
  }
  linha.push(campo); if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
  const [cabecalho = [], ...corpo] = linhas;
  return { cabecalho: cabecalho.map((c) => c.trim()), linhas: corpo.map((l) => l.map((c) => c.trim())), separador };
}

/** Nome de coluna comparável: sem acento, minúsculo, só letras e números separados por _. */
export const normalizarColuna = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Texto do arquivo: UTF-8; se tiver caracteres quebrados (Excel antigo), lê como Windows-1252. */
export function decodificarArquivo(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}
