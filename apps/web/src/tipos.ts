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

export interface Laudo {
  id: string; numero: number; numeroLaudo: string | null; empresaId: string; placa: string; chassi: string | null; dataLaudo: string;
  clienteId: string; cliente: string; servicoId: string; servico: string; vistoriadorId: string; vistoriador: string; formaPagamentoId: string; forma: string;
  precoTabelaCentavos: number | null; precoManual: boolean; valorCobradoCentavos: number; descontoCentavos: number; ajusteMotivo: string | null; duplicidadeMotivo: string | null; observacao: string | null;
  status: 'ATIVO' | 'CANCELADO'; cancelamentoPedidoEm: string | null; cancelamentoPedidoMotivo: string | null; cancelamentoPedidoPor: string | null; cancelamentoPedidoPorId: string | null;
  canceladoEm: string | null; motivoCancelamento: string | null; revisadoEm: string | null; travado: boolean; criadoEm: string; criadoPor: string | null;
  custosCentavos?: number; margemCentavos?: number; custos?: { descricao: string; tipo: 'VALOR' | 'PERCENTUAL'; valorCentavos: number; geraContaPagar: boolean }[];
}
export interface ResultadoLote { linha: number; ok: boolean; laudo?: Laudo; erro?: string; campos?: Record<string, string> }

export interface ContaCaixa { id: string; nome: string; tipo: 'CAIXA' | 'BANCO'; banco: string | null; status: 'ATIVO' | 'INATIVO'; saldoCentavos: number; fechadoAte: string | null }
export interface LinhaExtrato {
  id: string; data: string; valorCentavos: number; origem: string; origemId?: string | null; descricao: string; estornoDe?: string | null; motivo?: string | null;
  planoConta?: string | null; criadoPor?: string | null; estornado?: boolean; saldoCentavos: number; saldoInicial?: boolean;
}
export interface Extrato { conta: { id: string; nome: string; empresaId: string }; de: string; ate: string; aberturaCentavos: number; entradasCentavos: number; saidasCentavos: number; fechoCentavos: number; itens: LinhaExtrato[] }
export interface FechamentoDia { id: string; contaId: string; conta: string; data: string; saldoSistemaCentavos: number; saldoContadoCentavos: number; diferencaCentavos: number; observacao: string | null; status: 'FECHADO' | 'REABERTO'; fechadoPor: string | null; motivoReabertura: string | null }
export interface FechamentoMes { id: string; mes: string; status: 'FECHADO' | 'REABERTO'; fechadoPor: string | null; motivoReabertura: string | null }

export interface TituloItem {
  id: string; laudoId: string; numero: number; placa: string; dataLaudo: string; clienteId: string; cliente: string; servico: string; forma: string;
  valorCentavos: number; pagoCentavos: number; saldoCentavos: number; vencimento: string; status: 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'CANCELADO'; faturaId: string | null;
  vencido: boolean; diasAtraso: number; encargosCentavos: number;
}
export interface BaixaItem {
  id: string; data: string; principalCentavos: number; multaCentavos: number; jurosCentavos: number; perdaoCentavos: number; recebidoCentavos: number; forma: string; conta: string | null;
  estornoDe: string | null; motivo: string | null; criadoPor: string | null; estornada: boolean;
}
export interface TituloDetalhe extends TituloItem { baixas: BaixaItem[]; numeroNf: string | null; motivoCancelamento: string | null; formaTipo: string }
export interface SimulacaoBaixa { principalCentavos: number; saldoCentavos: number; data: string; diasAtraso: number; multaCentavos: number; jurosCentavos: number; totalCentavos: number }
export interface ConfigFinanceira { perdaoLimiteCentavos: number; aprovacaoPagarObrigatoria: boolean; financeiroAprovaPagar: boolean; financeiroVeDre: boolean }

export interface FaturaItem {
  id: string; clienteId: string; cliente: string; numero: number; periodoIni: string; periodoFim: string; emissao: string; vencimento: string; totalCentavos: number; saldoCentavos: number;
  status: 'ABERTA' | 'PARCIAL' | 'PAGA' | 'CANCELADA'; vencida: boolean; numeroNf: string | null; numeroBoleto: string | null;
}
export interface FaturaTitulo { id: string; numero: number; numeroLaudo: string | null; placa: string; dataLaudo: string; servico: string; valorCentavos: number; pagoCentavos: number; saldoCentavos: number; multaCentavos: number; jurosCentavos: number; status: string }
export interface FaturaDetalhe extends FaturaItem {
  observacao: string | null; motivoCancelamento: string | null; titulos: FaturaTitulo[]; encargosCentavos: number; totalHojeCentavos: number; recebidoCentavos: number; diasAtraso: number;
}
export interface PixFatura { disponivel: boolean; valorCentavos: number; copiaECola?: string; qrCode?: string; conta?: string; titular?: string | null }
export interface PreviaCliente { clienteId: string; cliente: string; periodicidade: 'SEMANAL' | 'QUINZENAL' | 'MENSAL'; prazoDias: number; titulos: number; totalCentavos: number; primeiroLaudo: string; ultimoLaudo: string }

export type StatusPagar = 'RASCUNHO' | 'PENDENTE' | 'APROVADO' | 'PARCIAL' | 'PAGO' | 'CANCELADO';
export interface TituloPagar {
  id: string; empresaId: string; fornecedorId: string | null; favorecido: string; descricao: string; planoContaId: string | null; planoConta: string | null; competencia: string; vencimento: string;
  valorCentavos: number; pagoCentavos: number; saldoCentavos: number; status: StatusPagar; origem: string; numeroDocumento: string | null; observacao: string | null; anexoId: string | null;
  motivoRejeicao: string | null; criadoPorId: string | null; criadoPor: string | null; aprovadoPor: string | null; vencido: boolean; recorrenciaId: string | null; rateioId: string | null;
}
export interface PagamentoPagar { id: string; data: string; principalCentavos: number; jurosCentavos: number; multaCentavos: number; descontoCentavos: number; pagoTotalCentavos: number; conta: string; comprovanteId: string | null; estornoDe: string | null; motivo: string | null; estornado: boolean }
export interface TituloPagarDetalhe extends TituloPagar { pagamentos: PagamentoPagar[]; anexo: { id: string; nome: string; mime: string } | null; motivoCancelamento: string | null; custos: { laudos: number; de: string; ate: string } | null }
export interface Recorrencia { id: string; descricao: string; fornecedor: string | null; valorCentavos: number; frequencia: 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'ANUAL'; dia: number; inicio: string; fim: string | null; geradaAte: string | null; ativa: boolean }
export interface CustoAApurar { fornecedorId: string; fornecedor: string; custos: number; laudos: number; totalCentavos: number }

export interface RelatorioDef { id: string; titulo: string; agrupar: string[] }
export interface RelatorioResposta { id: string; titulo: string; de?: string; ate?: string; colunas: { chave: string; rotulo: string; tipo: 'texto' | 'data' | 'dinheiro' | 'inteiro' | 'percentual' }[]; linhas: Record<string, unknown>[]; totais: Record<string, unknown> | null }
export interface Painel {
  perfil: string | null; hoje?: string; vinculado?: boolean; laudosHoje?: number; laudosMes?: number; valorHoje?: number; valorMes?: number; manuaisARevisar?: number; pedidosCancelamento?: number;
  aReceberCentavos?: number; vencidoCentavos?: number; aPagarCentavos?: number; pagarVencidoCentavos?: number; pendentesAprovacao?: number; saldoCaixaCentavos?: number; entradasMesCentavos?: number; saidasMesCentavos?: number;
  serie?: { dia: string; valor: number; laudos: number }[]; ultimos?: { id: string; numero: number; placa: string; servico: string; dataLaudo: string }[];
  lojas?: { id: string; nome: string; laudosMes: number; valorMes: number; aReceberCentavos: number; vencidoCentavos: number; aPagarCentavos: number }[];
}

export interface VendaCartao { id: string; numero: number; placa: string; cliente: string; forma: string; dataVenda: string; dataPrevista: string; brutoCentavos: number; taxaBp: number; taxaCentavos: number; antecipacaoCentavos: number; liquidoCentavos: number; status: 'PREVISTO' | 'LIQUIDADO' | 'CANCELADO'; conta: string | null; dataLiquidacao: string | null; atrasada: boolean }
export interface Cheque { id: string; numero: string; banco: string | null; emitente: string; bomPara: string; valorCentavos: number; status: 'RECEBIDO' | 'DEPOSITADO' | 'COMPENSADO' | 'DEVOLVIDO' | 'CANCELADO'; contaDeposito: string | null; depositadoEm: string | null; compensadoEm: string | null; devolvidoEm: string | null; motivoDevolucao: string | null; laudo: number; placa: string; cliente: string; podeDepositar: boolean }

export interface RegraComissao { id: string; vistoriadorId: string | null; vistoriador: string | null; servicoId: string | null; servico: string | null; tipo: 'PERCENTUAL' | 'VALOR'; percentualBp: number | null; valorCentavos: number | null; devidaEm: 'EMISSAO' | 'RECEBIMENTO'; vigenciaIni: string; vigenciaFim: string | null; ativa: boolean }
export interface ApuracaoComissao { vistoriadorId: string; vistoriador: string; laudos: number; totalCentavos: number; aguardandoCentavos: number; aguardandoLaudos: number }
export interface FechamentoComissao { id: string; vistoriador: string; periodoIni: string; periodoFim: string; laudos: number; totalCentavos: number; status: 'FECHADO' | 'CANCELADO'; motivoCancelamento: string | null; tituloPagarId: string | null; statusPagar: string | null }

export interface RegraRepasse { id: string; fornecedorId: string; fornecedor: string; nome: string; tipo: 'PERCENTUAL' | 'VALOR_FIXO'; percentualBp: number | null; valorCentavos: number | null; base: 'BRUTO' | 'LIQUIDO' | 'RECEBIDO' | null; vencimentoDia: number; vigenciaIni: string; vigenciaFim: string | null; ativa: boolean }
export interface PreviaRepasse { regraId: string; nome: string; fornecedor: string; tipo: string; baseCentavos: number; valorCentavos: number; baseTipo: string | null; apurada: boolean; apuracaoId: string | null }
export interface ApuracaoRepasse { id: string; mes: string; nome: string; fornecedor: string; baseCentavos: number; valorCentavos: number; status: 'APURADO' | 'CANCELADO'; motivoCancelamento: string | null; tituloPagarId: string | null; statusPagar: string | null }
export interface Aliquota { id: string; nome: 'ISS' | 'PIS' | 'COFINS' | 'SIMPLES_NACIONAL' | 'OUTRO'; descricao: string | null; percentualBp: number; vigenciaIni: string; vigenciaFim: string | null; ativa: boolean }
