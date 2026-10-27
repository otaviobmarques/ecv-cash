import { z } from 'zod';
import { cnpjValido, cpfValido } from './documentos';

const soDigitos = (s: string) => s.replace(/\D/g, '');
const vazioVira = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s);
const email = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(200);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.').refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida.');
const documento = (s: string) => cpfValido(s) || cnpjValido(s);

export const planoContaSchema = z.object({
  codigo: z.string().trim().regex(/^[0-9]+(\.[0-9]+)*$/, 'Use números separados por ponto, como 4.7.'),
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  tipo: z.enum(['RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'ATIVO', 'PASSIVO', 'PATRIMONIO']),
  paiId: z.string().uuid().optional(),
  aceitaLancamento: z.boolean().default(true),
});
export const editarPlanoContaSchema = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  aceitaLancamento: z.boolean().optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

export const servicoSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do serviço.').max(120),
  codigo: vazioVira(z.string().trim().max(20).optional()),
  contaReceitaId: vazioVira(z.string().uuid().optional()),
});
export const editarServicoSchema = servicoSchema.partial().extend({ status: z.enum(['ATIVO', 'INATIVO']).optional() });

export const servicoCustoSchema = z.object({
  descricao: z.string().trim().min(2, 'Descreva o custo.').max(120),
  tipo: z.enum(['VALOR', 'PERCENTUAL']),
  valorCentavos: z.number().int().min(0).max(100_000_00).nullish(),
  percentualBp: z.number().int().min(0).max(10_000).nullish(),
  geraContaPagar: z.boolean().default(false),
  fornecedorId: vazioVira(z.string().uuid().optional()),
}).superRefine((v, ctx) => {
  if (v.tipo === 'VALOR' && v.valorCentavos == null) ctx.addIssue({ code: 'custom', path: ['valorCentavos'], message: 'Informe o valor.' });
  if (v.tipo === 'PERCENTUAL' && v.percentualBp == null) ctx.addIssue({ code: 'custom', path: ['percentualBp'], message: 'Informe o percentual.' });
});

export const fornecedorSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(160),
  documento: vazioVira(z.string().transform(soDigitos).refine(documento, 'CPF ou CNPJ inválido.').optional()),
  tipo: z.enum(['FORNECEDOR', 'PRESTADOR', 'CONCESSIONARIA', 'ORGAO_PUBLICO', 'FRANQUEADOR']).default('FORNECEDOR'),
  email: vazioVira(email.optional()),
  contaPadraoId: vazioVira(z.string().uuid().optional()),
});
export const editarFornecedorSchema = fornecedorSchema.partial().extend({ status: z.enum(['ATIVO', 'INATIVO']).optional() });

export const clienteSchema = z.object({
  tipoPessoa: z.enum(['PF', 'PJ']),
  documento: vazioVira(z.string().transform(soDigitos).optional()),
  nome: z.string().trim().min(2, 'Informe o nome do cliente.').max(160),
  emailsCobranca: z.array(email).max(5, 'No máximo 5 e-mails.').default([]),
  telefone: vazioVira(z.string().trim().max(30).optional()),
  periodicidade: z.enum(['SEMANAL', 'QUINZENAL', 'MENSAL']).default('MENSAL'),
  prazoDias: z.number().int().min(0).max(365).default(10),
  multaBp: z.number().int().min(0).max(2000).default(200),
  jurosMesBp: z.number().int().min(0).max(1000).default(100),
}).superRefine((v, ctx) => {
  if (!v.documento) return;
  const ok = v.tipoPessoa === 'PF' ? cpfValido(v.documento) : cnpjValido(v.documento);
  if (!ok) ctx.addIssue({ code: 'custom', path: ['documento'], message: v.tipoPessoa === 'PF' ? 'CPF inválido.' : 'CNPJ inválido.' });
});
export const editarClienteSchema = z.object({
  nome: z.string().trim().min(2).max(160).optional(),
  emailsCobranca: z.array(email).max(5).optional(),
  telefone: vazioVira(z.string().trim().max(30).nullable().optional()),
  periodicidade: z.enum(['SEMANAL', 'QUINZENAL', 'MENSAL']).optional(),
  prazoDias: z.number().int().min(0).max(365).optional(),
  multaBp: z.number().int().min(0).max(2000).optional(),
  jurosMesBp: z.number().int().min(0).max(1000).optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

export const precoSchema = z.object({
  servicoId: z.string().uuid(),
  valorCentavos: z.number().int().min(1, 'Informe um valor maior que zero.').max(100_000_00),
  vigenciaIni: dataIso.optional(),
  motivo: vazioVira(z.string().trim().min(5, 'Explique o motivo em ao menos 5 caracteres.').max(300).optional()),
});

export const formaPagamentoSchema = z.object({
  nome: z.string().trim().min(2).max(60),
  tipo: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'CHEQUE', 'FATURADO', 'OUTRA']),
  geraFatura: z.boolean().default(false),
});
export const editarFormaPagamentoSchema = z.object({ nome: z.string().trim().min(2).max(60).optional(), status: z.enum(['ATIVO', 'INATIVO']).optional() });
export const formaEmpresaSchema = z.object({
  taxaBp: z.number().int().min(0).max(3000),
  prazoDias: z.number().int().min(0).max(180),
  antecipacaoBp: z.number().int().min(0).max(3000).default(0),
});

export const vistoriadorSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  cpf: vazioVira(z.string().transform(soDigitos).refine(cpfValido, 'CPF inválido.').optional()),
  empresaIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos uma loja.'),
  usuarioId: vazioVira(z.string().uuid().optional()),
});
export const editarVistoriadorSchema = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  empresaIds: z.array(z.string().uuid()).min(1).optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

const chavePix = (tipo: string, chave: string): boolean => {
  const d = soDigitos(chave);
  if (tipo === 'CNPJ') return cnpjValido(d);
  if (tipo === 'CPF') return cpfValido(d);
  if (tipo === 'EMAIL') return email.safeParse(chave).success;
  if (tipo === 'TELEFONE') return d.length === 10 || d.length === 11;
  return /^[0-9a-fA-F-]{32,36}$/.test(chave);
};

const camposContaBase = {
  nome: z.string().trim().min(2, 'Informe o nome da conta.').max(80),
  tipo: z.enum(['CAIXA', 'BANCO']),
  saldoInicialCentavos: z.number().int().default(0),
  dataSaldoInicial: dataIso.optional(),
  banco: vazioVira(z.string().trim().max(80).optional()),
  agencia: vazioVira(z.string().trim().regex(/^[0-9-]{1,10}$/, 'Só números e hífen.').optional()),
  conta: vazioVira(z.string().trim().regex(/^[0-9Xx-]{1,20}$/, 'Só números, X e hífen.').optional()),
  tipoConta: vazioVira(z.enum(['CORRENTE', 'POUPANCA', 'PAGAMENTO']).optional()),
  titular: vazioVira(z.string().trim().max(160).optional()),
  documentoTitular: vazioVira(z.string().transform(soDigitos).refine(documento, 'CPF ou CNPJ inválido.').optional()),
  pixTipo: vazioVira(z.enum(['CNPJ', 'CPF', 'EMAIL', 'TELEFONE', 'ALEATORIA']).optional()),
  pixChave: vazioVira(z.string().trim().max(120).optional()),
  exibirNaFatura: z.boolean().default(false),
};

/** Regras de completude: a conta que aparece na fatura precisa ter tudo que o cliente precisa para pagar. */
export function validarContaFinanceira(v: { tipo?: string; exibirNaFatura?: boolean; banco?: string | null; titular?: string | null; documentoTitular?: string | null; agencia?: string | null; conta?: string | null; pixTipo?: string | null; pixChave?: string | null }, ctx: z.RefinementCtx) {
  const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!!v.pixTipo !== !!v.pixChave) add('pixChave', 'Informe o tipo e a chave PIX.');
  if (v.pixTipo && v.pixChave && !chavePix(v.pixTipo, v.pixChave)) add('pixChave', 'Chave PIX inválida para o tipo escolhido.');
  if (v.exibirNaFatura) {
    if (v.tipo !== 'BANCO') add('exibirNaFatura', 'Só conta de banco aparece na fatura.');
    if (!v.banco) add('banco', 'Informe o banco para mostrar na fatura.');
    if (!v.titular) add('titular', 'Informe o titular para mostrar na fatura.');
    if (!v.documentoTitular) add('documentoTitular', 'Informe o CPF ou CNPJ do titular.');
    if (!((v.agencia && v.conta) || v.pixChave)) add('agencia', 'Informe agência e conta, ou a chave PIX.');
  }
}

export const contaFinanceiraSchema = z.object({ empresaId: z.string().uuid(), ...camposContaBase, senha: z.string().max(200).optional() }).superRefine(validarContaFinanceira);
/** Na edição só vão os campos que mudam; ausente = não muda, null = limpar o campo. */
export const editarContaFinanceiraSchema = z.object({
  nome: camposContaBase.nome.optional(),
  saldoInicialCentavos: camposContaBase.saldoInicialCentavos.optional(),
  dataSaldoInicial: dataIso.optional(),
  banco: z.string().trim().max(80).nullable().optional(),
  agencia: z.string().trim().regex(/^[0-9-]{1,10}$/, 'Só números e hífen.').nullable().optional(),
  conta: z.string().trim().regex(/^[0-9Xx-]{1,20}$/, 'Só números, X e hífen.').nullable().optional(),
  tipoConta: z.enum(['CORRENTE', 'POUPANCA', 'PAGAMENTO']).nullable().optional(),
  titular: z.string().trim().max(160).nullable().optional(),
  documentoTitular: z.string().transform(soDigitos).refine(documento, 'CPF ou CNPJ inválido.').nullable().optional(),
  pixTipo: z.enum(['CNPJ', 'CPF', 'EMAIL', 'TELEFONE', 'ALEATORIA']).nullable().optional(),
  pixChave: z.string().trim().max(120).nullable().optional(),
  exibirNaFatura: z.boolean().optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
  senha: z.string().max(200).optional(),
});
export const decidirPedidoSchema = z.object({ senha: z.string().min(1, 'Digite sua senha para confirmar.').max(200) });
export const rejeitarPedidoSchema = z.object({ motivo: z.string().trim().min(5, 'Explique o motivo.').max(300) });

export type ContaFinanceiraEntrada = z.infer<typeof contaFinanceiraSchema>;
