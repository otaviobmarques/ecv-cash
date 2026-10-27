import { divArredonda } from './dinheiro';

export interface RegraAtraso {
  /** multa única sobre o saldo, em bp (2% = 200) */
  multaBp: number;
  /** juros ao mês, em bp (1% = 100), pro rata por dia sobre mês de 30 dias */
  jurosMesBp: number;
}

export interface Atraso {
  diasAtraso: number;
  multa: number;
  juros: number;
  total: number;
}

const MS_DIA = 86_400_000;

/** Dias corridos entre duas datas ISO (AAAA-MM-DD), sem fuso. */
export function diasEntre(deIso: string, ateIso: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(ateIso) - d(deIso)) / MS_DIA);
}

/**
 * Multa e juros de um saldo vencido. Sem atraso (pagamento até o vencimento) não há encargo.
 * Multa: saldo * multa. Juros: saldo * jurosMes/30 * dias. Cada parcela arredondada ao centavo.
 */
export function calcularAtraso(
  saldo: number,
  vencimentoIso: string,
  pagamentoIso: string,
  regra: RegraAtraso,
): Atraso {
  const dias = diasEntre(vencimentoIso, pagamentoIso);
  if (dias <= 0 || saldo <= 0) return { diasAtraso: 0, multa: 0, juros: 0, total: saldo };
  const s = BigInt(saldo);
  const multa = Number(divArredonda(s * BigInt(regra.multaBp), 10000n));
  const juros = Number(divArredonda(s * BigInt(regra.jurosMesBp) * BigInt(dias), 10000n * 30n));
  return { diasAtraso: dias, multa, juros, total: saldo + multa + juros };
}
