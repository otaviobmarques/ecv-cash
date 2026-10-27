const soDigitos = (s: string) => s.replace(/\D/g, '');

export function normalizarCnpj(s: string): string {
  return soDigitos(s);
}

export function formatarCnpj(s: string): string {
  const d = soDigitos(s);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : s;
}

export function cnpjValido(s: string): boolean {
  const d = soDigitos(s);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i]!, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export function cpfValido(s: string): boolean {
  const d = soDigitos(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    const soma = d.slice(0, n).split('').reduce((acc, x, i) => acc + Number(x) * (n + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). Retorna a placa normalizada ou null. */
export function normalizarPlaca(s: string): string | null {
  const p = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d{4}$/.test(p) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(p) ? p : null;
}
