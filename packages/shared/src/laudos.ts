/** Chassi (VIN): 17 caracteres, sem as letras I, O e Q. */
export function normalizarChassi(s: string): string | null {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(c) ? c : null;
}

/** Desconto = tabela − cobrado. Negativo significa acréscimo sobre a tabela. Sem preço de tabela não há desconto. */
export const descontoDoLaudo = (precoTabela: number | null, valorCobrado: number): number => (precoTabela === null ? 0 : precoTabela - valorCobrado);

export interface ResolucaoPreco {
  precoTabela: number | null;
  precoManual: boolean;
  valorCobrado: number;
  /** o valor cobrado difere da tabela e por isso exige motivo */
  precisaMotivo: boolean;
}

/**
 * Decide o que o laudo cobra. Com preço na tabela, vale a tabela, a menos que quem tem permissão informe outro valor.
 * Sem preço, o valor digitado é obrigatório e o laudo fica marcado como "preço manual" para o Gerente revisar.
 */
export function resolverPreco(o: { precoTabela: number | null; valorManual?: number | null; valorCobrado?: number | null }): ResolucaoPreco | { erro: 'SEM_PRECO' | 'VALOR_INVALIDO' } {
  if (o.precoTabela === null) {
    if (o.valorManual == null || !Number.isInteger(o.valorManual) || o.valorManual <= 0) return { erro: 'SEM_PRECO' };
    return { precoTabela: null, precoManual: true, valorCobrado: o.valorManual, precisaMotivo: false };
  }
  const cobrado = o.valorCobrado ?? o.precoTabela;
  if (!Number.isInteger(cobrado) || cobrado < 0) return { erro: 'VALOR_INVALIDO' };
  return { precoTabela: o.precoTabela, precoManual: false, valorCobrado: cobrado, precisaMotivo: cobrado !== o.precoTabela };
}
