/** Vencimentos de uma recorrência entre o início e a data limite (inclusive). */
export function datasDaRecorrencia(frequencia: 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'ANUAL', dia: number, inicio: string, ate: string): string[] {
  const res: string[] = [];
  const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (frequencia === 'SEMANAL' || frequencia === 'QUINZENAL') {
    const passo = frequencia === 'SEMANAL' ? 7 : 14;
    let ms = utc(inicio);
    while (new Date(ms).getUTCDay() !== dia) ms += 86_400_000;
    for (; ms <= utc(ate); ms += passo * 86_400_000) res.push(iso(ms));
    return res;
  }
  let ano = +inicio.slice(0, 4); let mes = +inicio.slice(5, 7);
  const mesInicial = mes;
  for (let guarda = 0; guarda < 600; guarda++) {
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const d = iso(Date.UTC(ano, mes - 1, Math.min(dia, ultimoDia)));
    if (d > ate) break;
    if (d >= inicio) res.push(d);
    if (frequencia === 'ANUAL') { ano += 1; mes = mesInicial; } else { mes += 1; if (mes > 12) { mes = 1; ano += 1; } }
  }
  return res;
}
