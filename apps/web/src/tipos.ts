import type { Perfil, Permissao } from '@ecv/shared';

export interface Eu {
  id: string; nome: string; email: string; rede: boolean;
  empresas: { id: string; perfil: Perfil }[];
  empresaAtivaId: string | null;
  perfilAtivo: Perfil | null;
  permissoes: Permissao[];
  suporte: { usuarioInterno: string; motivo: string; expiraEm: string } | null;
}
export interface Empresa {
  id: string; cnpj: string; razaoSocial: string; nomeFantasia: string; uf: string; cidade: string;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'; emailFinanceiro: string | null; status: 'ATIVO' | 'INATIVO';
}
export interface UsuarioItem {
  id: string; nome: string; email: string; status: 'ATIVO' | 'INATIVO'; acessoRede: boolean; convitePendente: boolean;
  lotacoes: { empresaId: string; perfil: Perfil }[];
}
export interface TemaEfetivo {
  empresaId: string | null; corPrimaria: string; corSecundaria: string | null; corDestaque: string | null; escopo: 'GRUPO' | 'EMPRESA';
  derivado: { marca: string; marcaHover: string; textoSobreMarca: string; contrasteComBranco: number; contrasteComMarfim: number; legivelSobreFundoClaro: boolean };
}
export interface EventoAuditoria {
  id: number; criadoEm: string; acao: string; entidade: string; entidadeId: string | null; empresaId: string | null;
  usuario: string | null; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; motivo: string | null;
}
export const ROTULO_REGIME = { SIMPLES_NACIONAL: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real' } as const;
