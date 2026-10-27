import { aplicarBp } from './dinheiro';

/** Plano de contas inicial de todo grupo novo (editável pelo Administrativo). */
export interface ContaPadrao { codigo: string; nome: string; tipo: 'RECEITA' | 'DEDUCAO' | 'CUSTO' | 'DESPESA' | 'ATIVO' | 'PASSIVO' | 'PATRIMONIO'; aceitaLancamento: boolean }

export const PLANO_CONTAS_PADRAO: readonly ContaPadrao[] = [
  { codigo: '1', nome: 'Receitas', tipo: 'RECEITA', aceitaLancamento: false },
  { codigo: '1.1', nome: 'Vistoria cautelar', tipo: 'RECEITA', aceitaLancamento: true },
  { codigo: '1.2', nome: 'Vistoria de transferência', tipo: 'RECEITA', aceitaLancamento: true },
  { codigo: '1.3', nome: 'Vistoria de procedência', tipo: 'RECEITA', aceitaLancamento: true },
  { codigo: '1.4', nome: 'Outros serviços', tipo: 'RECEITA', aceitaLancamento: true },
  { codigo: '2', nome: 'Deduções da receita', tipo: 'DEDUCAO', aceitaLancamento: false },
  { codigo: '2.1', nome: 'ISS', tipo: 'DEDUCAO', aceitaLancamento: true },
  { codigo: '2.2', nome: 'PIS e COFINS', tipo: 'DEDUCAO', aceitaLancamento: true },
  { codigo: '3', nome: 'Custos dos serviços', tipo: 'CUSTO', aceitaLancamento: false },
  { codigo: '3.1', nome: 'Taxas do Detran e do sistema de laudo', tipo: 'CUSTO', aceitaLancamento: true },
  { codigo: '3.2', nome: 'Comissões de vistoriadores', tipo: 'CUSTO', aceitaLancamento: true },
  { codigo: '3.3', nome: 'Repasses a terceiros', tipo: 'CUSTO', aceitaLancamento: true },
  { codigo: '4', nome: 'Despesas operacionais', tipo: 'DESPESA', aceitaLancamento: false },
  { codigo: '4.1', nome: 'Pessoal', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '4.2', nome: 'Aluguel', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '4.3', nome: 'Água, luz, telefone e internet', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '4.4', nome: 'Royalties e fundo de marketing', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '4.5', nome: 'Administrativas', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '4.6', nome: 'Marketing', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '5', nome: 'Despesas financeiras', tipo: 'DESPESA', aceitaLancamento: false },
  { codigo: '5.1', nome: 'Taxas de cartão e antecipação', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '5.2', nome: 'Juros e multas pagos', tipo: 'DESPESA', aceitaLancamento: true },
  { codigo: '6', nome: 'Ativo', tipo: 'ATIVO', aceitaLancamento: false },
  { codigo: '6.1', nome: 'Caixa e bancos', tipo: 'ATIVO', aceitaLancamento: true },
  { codigo: '6.2', nome: 'Contas a receber', tipo: 'ATIVO', aceitaLancamento: true },
  { codigo: '6.3', nome: 'Imobilizado', tipo: 'ATIVO', aceitaLancamento: true },
  { codigo: '7', nome: 'Passivo', tipo: 'PASSIVO', aceitaLancamento: false },
  { codigo: '7.1', nome: 'Contas a pagar', tipo: 'PASSIVO', aceitaLancamento: true },
  { codigo: '7.2', nome: 'Empréstimos', tipo: 'PASSIVO', aceitaLancamento: true },
  { codigo: '8', nome: 'Patrimônio líquido', tipo: 'PATRIMONIO', aceitaLancamento: true },
];

export type TipoFormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'CHEQUE' | 'FATURADO' | 'OUTRA';
export const FORMAS_PAGAMENTO_PADRAO: readonly { nome: string; tipo: TipoFormaPagamento; geraFatura: boolean }[] = [
  { nome: 'Dinheiro', tipo: 'DINHEIRO', geraFatura: false },
  { nome: 'PIX', tipo: 'PIX', geraFatura: false },
  { nome: 'Cartão de débito', tipo: 'CARTAO_DEBITO', geraFatura: false },
  { nome: 'Cartão de crédito', tipo: 'CARTAO_CREDITO', geraFatura: false },
  { nome: 'Cheque', tipo: 'CHEQUE', geraFatura: false },
  { nome: 'Faturado', tipo: 'FATURADO', geraFatura: true },
];

export const ROTULO_TIPO_FORMA: Record<TipoFormaPagamento, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'PIX', CARTAO_DEBITO: 'Cartão de débito', CARTAO_CREDITO: 'Cartão de crédito', CHEQUE: 'Cheque', FATURADO: 'Faturado', OUTRA: 'Outra',
};

export interface CustoServico { tipo: 'VALOR' | 'PERCENTUAL'; valorCentavos?: number | null; percentualBp?: number | null }

/** Custo direto de um laudo: valor fixo, ou percentual do valor cobrado (arredondado ao centavo). */
export function custoDoLaudo(c: CustoServico, valorCobrado: number): number {
  if (c.tipo === 'VALOR') return c.valorCentavos ?? 0;
  return aplicarBp(valorCobrado, c.percentualBp ?? 0);
}

/** Margem do laudo = valor cobrado menos custos diretos e comissão. */
export function margemDoLaudo(valorCobrado: number, custos: number[], comissao = 0): number {
  return valorCobrado - custos.reduce((a, b) => a + b, 0) - comissao;
}

const DIA_MS = 86_400_000;
const paraData = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
const paraIso = (d: Date) => d.toISOString().slice(0, 10);
export const diaAnterior = (iso: string) => paraIso(new Date(paraData(iso).getTime() - DIA_MS));
export const diaSeguinte = (iso: string) => paraIso(new Date(paraData(iso).getTime() + DIA_MS));
