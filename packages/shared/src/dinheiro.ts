/**
 * Dinheiro sempre em centavos inteiros. Nunca float. Percentuais em pontos-base
 * (1% = 100 bp) para que todo o cálculo seja inteiro até o arredondamento final.
 */
export type Centavos = number;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarBRL(c: Centavos): string {
  return BRL.format(c / 100).replace(/ /g, ' ');
}

/** "1.234,56" ou "1234.56" ou "1234,5" -> 123456. Retorna null se inválido. */
export function paraCentavos(texto: string): Centavos | null {
  const t = texto.trim().replace(/^R\$\s*/, '');
  if (t === '') return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normal)) return null;
  const [int = '0', frac = ''] = normal.replace('-', '').split('.');
  const c = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return normal.startsWith('-') ? -c : c;
}

/** "2,00" ou "2" ou "2.5" -> 200 (bp). Retorna null se inválido. */
export function percentualParaBp(texto: string): number | null {
  const t = texto.trim().replace('%', '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Divisão inteira com arredondamento meio para cima (valores não negativos). */
export function divArredonda(numerador: bigint, denominador: bigint): bigint {
  return (2n * numerador + denominador) / (2n * denominador);
}

/** valor * bp / 10000, arredondado ao centavo. */
export function aplicarBp(valor: Centavos, bp: number): Centavos {
  const sinal = valor < 0 ? -1n : 1n;
  const abs = valor < 0 ? -valor : valor;
  return Number(sinal * divArredonda(BigInt(abs) * BigInt(bp), 10000n));
}

/** Divide `total` em partes proporcionais aos `pesos`, sem perder centavo (resto vai para as maiores partes). */
export function ratear(total: Centavos, pesos: number[]): Centavos[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma <= 0) throw new Error('Pesos do rateio devem somar mais que zero.');
  const partes = pesos.map((p) => Math.floor((total * p) / soma));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const ordem = pesos.map((p, i) => [p, i] as const).sort((x, y) => y[0] - x[0]);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto--) partes[ordem[k]![1]]! += 1;
  return partes;
}
