export const PAPEIS_INTERNOS = ['PLATAFORMA', 'OPERACOES', 'SUPORTE'] as const;
export type PapelInterno = (typeof PAPEIS_INTERNOS)[number];

export const ROTULO_PAPEL_INTERNO: Record<PapelInterno, string> = {
  PLATAFORMA: 'Plataforma',
  OPERACOES: 'Operações',
  SUPORTE: 'Suporte',
};

/** Matriz do backoffice (Etapa 5). */
export const MATRIZ_INTERNA = {
  'grupo.criar': ['PLATAFORMA', 'OPERACOES'],
  'grupo.suspender': ['PLATAFORMA', 'OPERACOES'],
  'grupo.ver': ['PLATAFORMA', 'OPERACOES', 'SUPORTE'],
  'grupo.log': ['PLATAFORMA', 'OPERACOES', 'SUPORTE'],
  'usuario.redefinir_acesso': ['PLATAFORMA', 'SUPORTE'],
  'suporte.entrar_como': ['PLATAFORMA', 'SUPORTE'],
  'interno.gerir': ['PLATAFORMA'],
} as const satisfies Record<string, readonly PapelInterno[]>;

export type PermissaoInterna = keyof typeof MATRIZ_INTERNA;

export const temPermissaoInterna = (papel: PapelInterno, p: PermissaoInterna): boolean =>
  (MATRIZ_INTERNA[p] as readonly PapelInterno[]).includes(papel);

export const MINUTOS_SUPORTE = 30;
