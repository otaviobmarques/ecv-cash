export interface TemaDerivadoApi { marca: string; marcaHover: string; textoSobreMarca: string }

/** Aplica o tema do cliente. Sem tema, volta ao verde do ECV Cash. */
export function aplicarTema(derivado: TemaDerivadoApi | null | undefined) {
  const r = document.documentElement.style;
  if (!derivado) {
    ['--brand', '--brand-hover', '--brand-ink'].forEach((p) => r.removeProperty(p));
    return;
  }
  r.setProperty('--brand', derivado.marca);
  r.setProperty('--brand-hover', derivado.marcaHover);
  r.setProperty('--brand-ink', derivado.textoSobreMarca);
}
