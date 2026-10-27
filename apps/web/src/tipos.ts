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

export interface PlanoConta { id: string; codigo: string; nome: string; tipo: string; paiId: string | null; aceitaLancamento: boolean; status: 'ATIVO' | 'INATIVO' }
export interface Custo { id: string; servicoId: string; descricao: string; tipo: 'VALOR' | 'PERCENTUAL'; valorCentavos: number | null; percentualBp: number | null; geraContaPagar: boolean; fornecedorId: string | null; status: 'ATIVO' | 'INATIVO' }
export interface Servico { id: string; nome: string; codigo?: string | null; contaReceitaId?: string | null; contaReceita?: string | null; status?: 'ATIVO' | 'INATIVO'; custos?: Custo[] }
export interface Fornecedor { id: string; nome: string; documento: string | null; tipo: 'FORNECEDOR' | 'PRESTADOR' | 'CONCESSIONARIA' | 'ORGAO_PUBLICO' | 'FRANQUEADOR'; email: string | null; contaPadraoId: string | null; status: 'ATIVO' | 'INATIVO' }
export interface ClienteItem { id: string; nome: string; tipoPessoa?: 'PF' | 'PJ'; documento?: string | null; status?: 'ATIVO' | 'INATIVO' }
export interface Preco { id: string; servicoId: string; servico: string; valorCentavos: number; vigenciaIni: string; vigenciaFim: string | null; motivo: string | null }
export interface ClienteDetalhe {
  id: string; nome: string; tipoPessoa: 'PF' | 'PJ'; documento: string | null; emailsCobranca: string[]; telefone: string | null;
  periodicidade: 'SEMANAL' | 'QUINZENAL' | 'MENSAL'; prazoDias: number; multaBp: number; jurosMesBp: number; status: 'ATIVO' | 'INATIVO'; precos: Preco[];
}
export interface FormaPagamento {
  id: string; nome: string; tipo: string; geraFatura?: boolean; status?: 'ATIVO' | 'INATIVO';
  empresas?: { formaId: string; empresaId: string; taxaBp: number; prazoDias: number; antecipacaoBp: number }[];
}
export interface VistoriadorItem { id: string; nome: string; cpf: string | null; usuarioId: string | null; status: 'ATIVO' | 'INATIVO'; empresaIds: string[] }
export interface ContaFinanceira {
  id: string; empresaId: string; nome: string; tipo: 'CAIXA' | 'BANCO'; saldoInicialCentavos: number | string; dataSaldoInicial: string;
  banco: string | null; agencia: string | null; conta: string | null; tipoConta: string | null; titular: string | null; documentoTitular: string | null;
  pixTipo: string | null; pixChave: string | null; exibirNaFatura: boolean; status: 'ATIVO' | 'INATIVO';
  pedidoPendente: { id: string; solicitadoPor: string; criadoEm: string } | null;
}
export interface PedidoConta { id: string; empresaId: string; contaId: string | null; conta: string | null; dados: Record<string, unknown>; status: 'PENDENTE' | 'APROVADO' | 'REJEITADO'; solicitadoPor: string; criadoEm: string; decididoEm: string | null; motivoRejeicao: string | null }
