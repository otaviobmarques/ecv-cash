export type Periodicidade = 'SEMANAL' | 'QUINZENAL' | 'MENSAL';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
const somar = (s: string, dias: number) => iso(new Date(utc(s).getTime() + dias * 86_400_000));

/**
 * Período que fecha antes de `hoje`, para cada periodicidade:
 * semanal = a última semana inteira (segunda a domingo); quinzenal = a última quinzena inteira (1 a 15 ou 16 a fim do mês); mensal = o último mês inteiro.
 */
export function periodoSugerido(periodicidade: Periodicidade, hoje: string): { ini: string; fim: string } {
  if (periodicidade === 'SEMANAL') {
    const dow = (utc(hoje).getUTCDay() + 6) % 7; // 0 = segunda
    const fim = somar(hoje, -(dow + 1));
    return { ini: somar(fim, -6), fim };
  }
  const ano = +hoje.slice(0, 4), mes = +hoje.slice(5, 7), dia = +hoje.slice(8, 10);
  const fimDoMes = (a: number, m: number) => iso(new Date(Date.UTC(a, m, 0)));
  const mm = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`;
  if (periodicidade === 'QUINZENAL') {
    if (dia > 15) return { ini: `${mm(ano, mes)}-01`, fim: `${mm(ano, mes)}-15` };
    const [a, m] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
    return { ini: `${mm(a, m)}-16`, fim: fimDoMes(a, m) };
  }
  const [a, m] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
  return { ini: `${mm(a, m)}-01`, fim: fimDoMes(a, m) };
}
