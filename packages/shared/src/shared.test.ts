import { describe, expect, it } from 'vitest';
import {
  MATRIZ, PERFIS, aplicarBp, calcularAtraso, cnpjValido, contraste, cpfValido, derivarTema, formatarBRL,
  normalizarPlaca, criarEmpresaSchema, descontoDoLaudo, laudoSchema, loteSchema, normalizarChassi, resolverPreco, clienteSchema, contaFinanceiraSchema, custoDoLaudo, diaAnterior, diaSeguinte, margemDoLaudo, precoSchema, servicoCustoSchema, PLANO_CONTAS_PADRAO, FORMAS_PAGAMENTO_PADRAO, paraCentavos, percentualParaBp, podeCriarUsuario, ratear, temPermissao, permissoesDoPerfil,
} from './index';

describe('matriz de permissões (Etapa 5)', () => {
  it('Vistoriador só lança e vê os próprios laudos', () => {
    const p = permissoesDoPerfil('VISTORIADOR');
    expect(p).toContain('laudo.lancar');
    expect(p).toContain('laudo.ver_proprios');
    expect(p).not.toContain('receber.ver');
    expect(p).not.toContain('relatorio.operacional');
    expect(p).not.toContain('laudo.desconto');
  });
  it('quem cria pagamento não aprova: Financeiro não aprova', () => {
    expect(temPermissao('FINANCEIRO', 'pagar.criar')).toBe(true);
    expect(temPermissao('FINANCEIRO', 'pagar.aprovar')).toBe(false);
    expect(temPermissao('GERENTE', 'pagar.aprovar')).toBe(true);
  });
  it('só o Administrativo reajusta preço; Gerente cadastra o primeiro', () => {
    expect(temPermissao('GERENTE', 'preco.reajustar')).toBe(false);
    expect(temPermissao('GERENTE', 'preco.cadastrar_primeiro')).toBe(true);
    expect(temPermissao('ADMINISTRATIVO', 'preco.reajustar')).toBe(true);
  });
  it('DRE e Balanço não estão com o Financeiro por padrão', () => {
    expect(temPermissao('FINANCEIRO', 'relatorio.dre_balanco')).toBe(false);
    expect(temPermissao('FINANCEIRO', 'relatorio.fluxo_caixa')).toBe(true);
  });
  it('rateio, intercompany e reabrir período são só do Administrativo', () => {
    for (const perm of ['pagar.rateio', 'transferencia.intercompany', 'periodo.reabrir'] as const) {
      expect(PERFIS.filter((p) => temPermissao(p, perm))).toEqual(['ADMINISTRATIVO']);
    }
  });
  it('toda permissão tem ao menos um perfil', () => {
    for (const [k, v] of Object.entries(MATRIZ)) expect(v.length, k).toBeGreaterThan(0);
  });
});

describe('quem cria usuário', () => {
  const lojaA = '11111111-1111-1111-1111-111111111111';
  const lojaB = '22222222-2222-2222-2222-222222222222';
  const gerenteA = { rede: false, perfilPorEmpresa: { [lojaA]: 'GERENTE' as const, [lojaB]: 'FINANCEIRO' as const } };
  it('Administrativo cria qualquer perfil', () => {
    expect(podeCriarUsuario({ rede: true, perfilPorEmpresa: {} }, { perfil: 'GERENTE', empresaIds: [lojaA] }).ok).toBe(true);
  });
  it('Gerente cria Financeiro e Vistoriador na própria loja', () => {
    expect(podeCriarUsuario(gerenteA, { perfil: 'VISTORIADOR', empresaIds: [lojaA] }).ok).toBe(true);
  });
  it('Gerente não cria Gerente nem Administrativo', () => {
    expect(podeCriarUsuario(gerenteA, { perfil: 'GERENTE', empresaIds: [lojaA] }).ok).toBe(false);
    expect(podeCriarUsuario(gerenteA, { perfil: 'ADMINISTRATIVO', empresaIds: [lojaA] }).ok).toBe(false);
  });
  it('Gerente não dá acesso a loja onde ele não é Gerente', () => {
    expect(podeCriarUsuario(gerenteA, { perfil: 'FINANCEIRO', empresaIds: [lojaB] }).ok).toBe(false);
  });
  it('Financeiro e Vistoriador não gerenciam usuários', () => {
    expect(podeCriarUsuario({ rede: false, perfilPorEmpresa: { [lojaA]: 'FINANCEIRO' } }, { perfil: 'VISTORIADOR', empresaIds: [lojaA] }).ok).toBe(false);
  });
});

describe('dinheiro', () => {
  it('converte texto em centavos', () => {
    expect(paraCentavos('1.234,56')).toBe(123456);
    expect(paraCentavos('R$ 180')).toBe(18000);
    expect(paraCentavos('180,5')).toBe(18050);
    expect(paraCentavos('abc')).toBeNull();
    expect(paraCentavos('1,234')).toBeNull();
  });
  it('formata em reais', () => expect(formatarBRL(457447)).toBe('R$ 4.574,47'));
  it('percentual em pontos-base', () => {
    expect(percentualParaBp('2,00')).toBe(200);
    expect(percentualParaBp('1,19%')).toBe(119);
    expect(percentualParaBp('x')).toBeNull();
  });
  it('aplica percentual arredondando meio para cima', () => {
    expect(aplicarBp(10000, 269)).toBe(269);
    expect(aplicarBp(1010, 50)).toBe(5); // 5,05 -> 5
    expect(aplicarBp(1050, 50)).toBe(5); // 5,25 -> 5
    expect(aplicarBp(1100, 50)).toBe(6); // 5,50 -> 6 (meio para cima)
  });
  it('rateio não perde centavo', () => {
    expect(ratear(10000, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(ratear(10001, [50, 30, 20]).reduce((a, b) => a + b, 0)).toBe(10001);
  });
});

describe('juros e multa (mesmos números do protótipo)', () => {
  const regra = { multaBp: 200, jurosMesBp: 100 };
  it('fatura da Transportadora Lima: 17 dias de atraso sobre R$ 4.460,00', () => {
    const r = calcularAtraso(446000, '2026-10-10', '2026-10-27', regra);
    expect(r.diasAtraso).toBe(17);
    expect(r.multa).toBe(8920);
    expect(r.juros).toBe(2527);
    expect(r.total).toBe(446000 + 8920 + 2527);
  });
  it('pagamento no vencimento ou antes não tem encargo', () => {
    expect(calcularAtraso(10000, '2026-10-10', '2026-10-10', regra).total).toBe(10000);
    expect(calcularAtraso(10000, '2026-10-10', '2026-10-01', regra).multa).toBe(0);
  });
  it('um dia de atraso cobra a multa inteira e um dia de juros', () => {
    const r = calcularAtraso(918000, '2026-10-26', '2026-10-27', regra);
    expect(r.multa).toBe(18360);
    expect(r.juros).toBe(306);
  });
});

describe('contraste do tema (Design System ECV Cash)', () => {
  it('bate com a tabela de acessibilidade do kit', () => {
    expect(contraste('#104B3A', '#FFFFFF')).toBeGreaterThan(9.5);
    expect(Math.round(contraste('#008B49', '#FFFFFF') * 100) / 100).toBe(4.38);
  });
  it('troca para texto escuro quando o branco não passa em 4,5:1', () => {
    expect(derivarTema('#104B3A').textoSobreMarca).toBe('#FFFFFF');
    expect(derivarTema('#80BC43').textoSobreMarca).toBe('#18382E');
  });
  it('avisa quando a cor não serve como texto sobre fundo claro', () => {
    expect(derivarTema('#FFE066').legivelSobreFundoClaro).toBe(false);
    expect(derivarTema('#104B3A').legivelSobreFundoClaro).toBe(true);
  });
});

describe('cadastro de empresa', () => {
  const base = { cnpj: '11.222.333/0001-81', razaoSocial: 'Loja Centro Ltda', nomeFantasia: 'Loja Centro', uf: 'sp', cidade: 'Santos', regimeTributario: 'SIMPLES_NACIONAL' };
  it('e-mail do financeiro vazio vale como não informado', () => {
    const r = criarEmpresaSchema.parse({ ...base, emailFinanceiro: '' });
    expect(r.emailFinanceiro).toBeUndefined();
    expect(r.cnpj).toBe('11222333000181');
    expect(r.uf).toBe('SP');
  });
  it('e-mail preenchido precisa ser válido', () => {
    expect(criarEmpresaSchema.safeParse({ ...base, emailFinanceiro: 'financeiro@loja.com.br' }).success).toBe(true);
    expect(criarEmpresaSchema.safeParse({ ...base, emailFinanceiro: 'sem-arroba' }).success).toBe(false);
  });
});

describe('documentos e placa', () => {
  it('valida CNPJ e CPF pelos dígitos', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });
  it('aceita placa antiga e Mercosul', () => {
    expect(normalizarPlaca('abc-1234')).toBe('ABC1234');
    expect(normalizarPlaca('RTX4F21')).toBe('RTX4F21');
    expect(normalizarPlaca('AB12345')).toBeNull();
    expect(normalizarPlaca('1BC1D23')).toBeNull();
  });
});

describe('cadastros: custo, margem e vigência', () => {
  it('custo fixo e percentual sobre o valor cobrado', () => {
    expect(custoDoLaudo({ tipo: 'VALOR', valorCentavos: 3800 }, 18000)).toBe(3800);
    expect(custoDoLaudo({ tipo: 'PERCENTUAL', percentualBp: 500 }, 18000)).toBe(900);
    expect(custoDoLaudo({ tipo: 'PERCENTUAL', percentualBp: 333 }, 18000)).toBe(599); // 599,4 arredonda ao centavo
  });
  it('margem = cobrado − custos − comissão', () => {
    expect(margemDoLaudo(18000, [3800, 600], 1440)).toBe(12160);
  });
  it('dia anterior e seguinte atravessam mês e ano', () => {
    expect(diaAnterior('2026-11-01')).toBe('2026-10-31');
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31');
    expect(diaSeguinte('2026-02-28')).toBe('2026-03-01');
    expect(diaSeguinte('2028-02-28')).toBe('2028-02-29');
  });
  it('plano de contas padrão tem códigos únicos e pais coerentes', () => {
    const codigos = PLANO_CONTAS_PADRAO.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of PLANO_CONTAS_PADRAO.filter((x) => x.codigo.includes('.'))) {
      expect(codigos, c.codigo).toContain(c.codigo.slice(0, c.codigo.lastIndexOf('.')));
    }
  });
  it('formas padrão: só o Faturado gera fatura', () => {
    expect(FORMAS_PAGAMENTO_PADRAO.filter((f) => f.geraFatura).map((f) => f.tipo)).toEqual(['FATURADO']);
  });
});

describe('cadastros: validações', () => {
  it('cliente PF exige CPF válido e PJ exige CNPJ válido; documento é opcional', () => {
    const base = { nome: 'Fulano', emailsCobranca: [] };
    expect(clienteSchema.safeParse({ ...base, tipoPessoa: 'PF', documento: '529.982.247-25' }).success).toBe(true);
    expect(clienteSchema.safeParse({ ...base, tipoPessoa: 'PF', documento: '11222333000181' }).success).toBe(false);
    expect(clienteSchema.safeParse({ ...base, tipoPessoa: 'PJ', documento: '11.222.333/0001-81' }).success).toBe(true);
    expect(clienteSchema.safeParse({ ...base, tipoPessoa: 'PJ', documento: '' }).success).toBe(true);
  });
  it('cliente nasce com os padrões de fatura: mensal, 10 dias, multa 2%, juros 1% ao mês', () => {
    const r = clienteSchema.parse({ nome: 'Fulano', tipoPessoa: 'PF' });
    expect(r).toMatchObject({ periodicidade: 'MENSAL', prazoDias: 10, multaBp: 200, jurosMesBp: 100 });
  });
  it('custo por valor exige o valor; por percentual exige o percentual', () => {
    expect(servicoCustoSchema.safeParse({ descricao: 'Taxa Detran', tipo: 'VALOR' }).success).toBe(false);
    expect(servicoCustoSchema.safeParse({ descricao: 'Taxa Detran', tipo: 'VALOR', valorCentavos: 3800 }).success).toBe(true);
    expect(servicoCustoSchema.safeParse({ descricao: 'Repasse', tipo: 'PERCENTUAL' }).success).toBe(false);
  });
  it('conta que aparece na fatura precisa estar completa e a chave PIX bater com o tipo', () => {
    const base = { empresaId: '11111111-1111-1111-1111-111111111111', nome: 'Itaú', tipo: 'BANCO', exibirNaFatura: true };
    const msgs = (v: object) => { const r = contaFinanceiraSchema.safeParse({ ...base, ...v }); return r.success ? [] : r.error.issues.map((i) => i.path[0]); };
    expect(msgs({})).toEqual(expect.arrayContaining(['banco', 'titular', 'documentoTitular']));
    const completa = { banco: 'Itaú (341)', titular: 'Centro Vistorias Ltda', documentoTitular: '11222333000181', agencia: '1234', conta: '12345-6' };
    expect(msgs(completa)).toEqual([]);
    expect(msgs({ ...completa, agencia: undefined, conta: undefined })).toContain('agencia');
    expect(msgs({ ...completa, pixTipo: 'CNPJ', pixChave: '11222333000199' })).toContain('pixChave');
    expect(msgs({ ...completa, pixTipo: 'CNPJ', pixChave: '11.222.333/0001-81' })).toEqual([]);
    expect(msgs({ ...completa, pixTipo: 'EMAIL', pixChave: 'sem-arroba' })).toContain('pixChave');
    expect(msgs({ ...completa, tipo: 'CAIXA' })).toContain('exibirNaFatura');
  });
  it('preço exige valor positivo; reajuste de preço usa centavos inteiros', () => {
    expect(precoSchema.safeParse({ servicoId: '11111111-1111-1111-1111-111111111111', valorCentavos: 0 }).success).toBe(false);
    expect(precoSchema.safeParse({ servicoId: '11111111-1111-1111-1111-111111111111', valorCentavos: 18000.5 }).success).toBe(false);
    expect(precoSchema.safeParse({ servicoId: '11111111-1111-1111-1111-111111111111', valorCentavos: 18000, vigenciaIni: '2026-11-01' }).success).toBe(true);
  });
});

describe('laudos: preço, chassi e validações', () => {
  it('com preço na tabela vale a tabela; outro valor exige motivo', () => {
    expect(resolverPreco({ precoTabela: 18000 })).toEqual({ precoTabela: 18000, precoManual: false, valorCobrado: 18000, precisaMotivo: false });
    expect(resolverPreco({ precoTabela: 18000, valorCobrado: 16500 })).toMatchObject({ valorCobrado: 16500, precisaMotivo: true });
    expect(resolverPreco({ precoTabela: 18000, valorCobrado: 0 })).toMatchObject({ valorCobrado: 0, precisaMotivo: true });
    expect(resolverPreco({ precoTabela: 18000, valorCobrado: -1 })).toEqual({ erro: 'VALOR_INVALIDO' });
  });
  it('sem preço o valor digitado é obrigatório e marca o laudo como preço manual', () => {
    expect(resolverPreco({ precoTabela: null })).toEqual({ erro: 'SEM_PRECO' });
    expect(resolverPreco({ precoTabela: null, valorManual: 0 })).toEqual({ erro: 'SEM_PRECO' });
    expect(resolverPreco({ precoTabela: null, valorManual: 14000 })).toEqual({ precoTabela: null, precoManual: true, valorCobrado: 14000, precisaMotivo: false });
  });
  it('desconto é tabela menos cobrado; acréscimo é negativo; sem tabela não há desconto', () => {
    expect(descontoDoLaudo(18000, 16500)).toBe(1500);
    expect(descontoDoLaudo(18000, 19000)).toBe(-1000);
    expect(descontoDoLaudo(null, 14000)).toBe(0);
  });
  it('chassi: 17 caracteres sem I, O e Q', () => {
    expect(normalizarChassi('9bwzzz377vt004251')).toBe('9BWZZZ377VT004251');
    expect(normalizarChassi('9BWZZZ377VT00425I')).toBeNull();
    expect(normalizarChassi('9BWZZZ377VT0042')).toBeNull();
  });
  const base = { placa: 'rtx-4f21', clienteId: '11111111-1111-1111-1111-111111111111', servicoId: '22222222-2222-2222-2222-222222222222', formaPagamentoId: '33333333-3333-3333-3333-333333333333' };
  it('lançamento normaliza a placa e aceita os campos opcionais vazios', () => {
    const r = laudoSchema.parse({ ...base, chassi: '', numeroLaudo: '', observacao: '  ' });
    expect(r.placa).toBe('RTX4F21');
    expect(r.chassi).toBeUndefined();
  });
  it('recusa placa inválida, valor com centavos quebrados e motivo curto', () => {
    expect(laudoSchema.safeParse({ ...base, placa: 'AB12345' }).success).toBe(false);
    expect(laudoSchema.safeParse({ ...base, valorManualCentavos: 180.5 }).success).toBe(false);
    expect(laudoSchema.safeParse({ ...base, ajusteMotivo: 'oi' }).success).toBe(false);
    expect(laudoSchema.safeParse({ ...base, valorManualCentavos: 14000, dataLaudo: '2026-10-27' }).success).toBe(true);
  });
  it('lote aceita até 50 linhas e exige ao menos uma', () => {
    expect(loteSchema.safeParse({ itens: [] }).success).toBe(false);
    expect(loteSchema.safeParse({ itens: Array.from({ length: 51 }, () => ({})) }).success).toBe(false);
    expect(loteSchema.safeParse({ itens: [{}] }).success).toBe(true);
  });
});
