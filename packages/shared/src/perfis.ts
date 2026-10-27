export const PERFIS = ['ADMINISTRATIVO', 'GERENTE', 'FINANCEIRO', 'VISTORIADOR'] as const;
export type Perfil = (typeof PERFIS)[number];

export const ROTULO_PERFIL: Record<Perfil, string> = {
  ADMINISTRATIVO: 'Administrativo (rede)',
  GERENTE: 'Gerente',
  FINANCEIRO: 'Financeiro',
  VISTORIADOR: 'Vistoriador',
};

/** Perfis que o Gerente pode criar e editar na própria loja. */
export const PERFIS_DO_GERENTE: readonly Perfil[] = ['FINANCEIRO', 'VISTORIADOR'];
