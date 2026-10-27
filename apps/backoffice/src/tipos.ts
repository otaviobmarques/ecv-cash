import type { PapelInterno, PermissaoInterna } from '@ecv/shared';

export interface Interno { id: string; nome: string; email: string; papel: PapelInterno; permissoes: PermissaoInterna[] }
export interface GrupoItem { id: string; nome: string; status: 'ATIVO' | 'SUSPENSO' | 'ENCERRADO'; criadoEm: string; empresas: number; usuarios: number; ultimoAcesso: string | null }
export interface GrupoDetalhe {
  id: string; nome: string; status: GrupoItem['status']; criadoEm: string;
  empresas: { id: string; cnpj: string; nomeFantasia: string; uf: string; cidade: string; status: string }[];
  usuarios: { id: string; nome: string; email: string; status: string; acessoRede: boolean; convitePendente: boolean; ultimoLogin: string | null; lotacoes: { empresaId: string; perfil: string }[] }[];
  acessosSuporte: { id: string; motivo: string; inicio: string; expiraEm: string; encerradaEm: string | null; usuarioInterno: string }[];
}
export interface EventoGrupo { id: number; criadoEm: string; acao: string; entidade: string; entidadeId: string | null; motivo: string | null; autor: string | null }
