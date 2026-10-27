const HEX = /^#[0-9a-fA-F]{6}$/;

export const ehHex = (h: string) => HEX.test(h);

function canais(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export function luminancia(h: string): number {
  const [r, g, b] = canais(h).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores hex (1 a 21). */
export function contraste(a: string, b: string): number {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const BRANCO = '#FFFFFF';
export const MARFIM = '#F7F8F2';
export const TEXTO_ESCURO = '#18382E';

export interface TemaDerivado {
  marca: string;
  marcaHover: string;
  textoSobreMarca: string;
  contrasteComBranco: number;
  contrasteComMarfim: number;
  /** a cor serve como texto e botão sobre fundo claro (>= 4,5:1 com o marfim) */
  legivelSobreFundoClaro: boolean;
}

function escurecer(h: string, fator: number): string {
  return '#' + canais(h).map((c) => Math.round(Math.max(0, Math.min(1, c * fator)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Deriva tokens do tema do cliente a partir de uma cor de marca. */
export function derivarTema(marca: string): TemaDerivado {
  const cb = contraste(marca, BRANCO);
  const cm = contraste(marca, MARFIM);
  return {
    marca: marca.toUpperCase(),
    marcaHover: escurecer(marca, 0.78),
    textoSobreMarca: cb >= 4.5 ? BRANCO : TEXTO_ESCURO,
    contrasteComBranco: Math.round(cb * 100) / 100,
    contrasteComMarfim: Math.round(cm * 100) / 100,
    legivelSobreFundoClaro: cm >= 4.5,
  };
}
