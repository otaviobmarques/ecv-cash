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

export interface PlanoSaas { id: string; nome: string; descricao: string | null; valorBaseCentavos: number; empresasIncluidas: number; valorEmpresaAdicionalCentavos: number; ativo: boolean; assinaturas: number }
export interface AssinaturaSaas {
  id: string; planoId: string; planoNome: string; valorBaseCentavos: number; empresasIncluidas: number; valorEmpresaAdicionalCentavos: number; descontoBp: number; diaVencimento: number;
  inicio: string; testeAte: string | null; status: 'ATIVA' | 'INADIMPLENTE' | 'CANCELADA'; carenciaDias: number; suspendeEmAtraso: boolean; suspensoPorAtraso: boolean; motivoCancelamento: string | null;
}
export interface CobrancaSaas {
  id: string; competencia: string; vencimento: string; empresasCobradas: number; valorBrutoCentavos: number; descontoCentavos: number; valorCentavos: number;
  status: 'ABERTA' | 'PAGA' | 'CANCELADA'; pagoEm: string | null; formaPagamento: string | null; referencia: string | null; motivoCancelamento: string | null;
}
export interface AssinaturaDoGrupo { assinatura: AssinaturaSaas | null; cobrancas: CobrancaSaas[]; empresasAtivas: number }
export interface CobrancaGlobal { id: string; grupoId: string; grupoNome: string; competencia: string; vencimento: string; valorCentavos: number; status: CobrancaSaas['status']; pagoEm: string | null; formaPagamento: string | null; referencia: string | null; assinaturaStatus: AssinaturaSaas['status'] }
