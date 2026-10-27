import { ForbiddenException } from '@nestjs/common';
import { Perfil, Permissao, temPermissao } from '@ecv/shared';
import type { ContextoDb } from '../db/db.service';

/** Quem está chamando, resolvido a partir da sessão. */
export interface Acesso {
  sessaoId: string;
  usuarioId: string;
  nome: string;
  email: string;
  grupoId: string;
  rede: boolean;
  /** lojas a que o usuário tem acesso; para o Administrativo, todas as ativas do grupo */
  empresas: { id: string; perfil: Perfil }[];
  empresaAtivaId: string | null;
  ip?: string;
  userAgent?: string;
}

export const contextoDb = (a: Acesso): ContextoDb => ({
  grupoId: a.grupoId,
  usuarioId: a.usuarioId,
  rede: a.rede,
  empresas: a.empresas.map((e) => e.id),
});

export function perfilEm(a: Acesso, empresaId: string | null | undefined): Perfil | null {
  if (a.rede) return 'ADMINISTRATIVO';
  if (!empresaId) return null;
  return a.empresas.find((e) => e.id === empresaId)?.perfil ?? null;
}

export const perfilAtivo = (a: Acesso): Perfil | null => perfilEm(a, a.empresaAtivaId);

/** Lança 403 se o perfil do usuário na loja indicada (ou na loja ativa) não tem a permissão. */
export function exigir(a: Acesso, permissao: Permissao, empresaId?: string | null): Perfil {
  const perfil = perfilEm(a, empresaId === undefined ? a.empresaAtivaId : empresaId);
  if (!perfil || !temPermissao(perfil, permissao)) {
    throw new ForbiddenException('Você não tem permissão para esta ação.');
  }
  return perfil;
}
