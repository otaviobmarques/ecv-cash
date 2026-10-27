import { describe, expect, it } from 'vitest';
import {
  MATRIZ, PERFIS, aplicarBp, calcularAtraso, cnpjValido, contraste, cpfValido, derivarTema, formatarBRL,
  normalizarPlaca, criarEmpresaSchema, paraCentavos, percentualParaBp, podeCriarUsuario, ratear, temPermissao, permissoesDoPerfil,
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
