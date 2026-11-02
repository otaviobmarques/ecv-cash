import { describe, expect, it } from 'vitest';
import { calcularMensalidade, competenciasDevidas, somarMeses, vencimentoDaCompetencia } from './schemas-assinatura';

describe('mensalidade do SaaS', () => {
  const base = { valorBaseCentavos: 19900, empresasIncluidas: 2, valorEmpresaAdicionalCentavos: 5000, descontoBp: 0 };
  it('cobra só as empresas além das incluídas', () => {
    expect(calcularMensalidade({ ...base, empresas: 1 }).valorCentavos).toBe(19900);
    expect(calcularMensalidade({ ...base, empresas: 2 }).valorCentavos).toBe(19900);
    expect(calcularMensalidade({ ...base, empresas: 5 })).toMatchObject({ extras: 3, brutoCentavos: 34900, valorCentavos: 34900 });
  });
  it('desconto em pontos-base, arredondado, sem float', () => {
    const m = calcularMensalidade({ ...base, empresas: 1, descontoBp: 1000 });
    expect(m).toMatchObject({ brutoCentavos: 19900, descontoCentavos: 1990, valorCentavos: 17910 });
    expect(calcularMensalidade({ ...base, valorBaseCentavos: 10001, empresas: 1, descontoBp: 5000 }).descontoCentavos).toBe(5001); // 5000,5 arredonda para cima
    expect(calcularMensalidade({ ...base, empresas: 1, descontoBp: 10000 }).valorCentavos).toBe(0);
  });
  it('datas de competência', () => {
    expect(somarMeses('2026-11-01', 2)).toBe('2027-01-01');
    expect(somarMeses('2026-01-01', -1)).toBe('2025-12-01');
    expect(vencimentoDaCompetencia('2026-03-01', 7)).toBe('2026-03-07');
  });
  it('mensalidade nasce 10 dias antes do vencimento e respeita o teste', () => {
    const a = { inicio: '2026-01-05', diaVencimento: 10 };
    expect(competenciasDevidas(a, '2026-01-20').map((x) => x.vencimento)).toEqual(['2026-01-10']);
    expect(competenciasDevidas(a, '2026-02-01').map((x) => x.vencimento)).toEqual(['2026-01-10', '2026-02-10']);
    expect(competenciasDevidas(a, '2025-12-20')).toEqual([]);
    // teste até 20/02: a primeira cobrança é a de 10/03
    const t = { ...a, testeAte: '2026-02-20' };
    expect(competenciasDevidas(t, '2026-03-01').map((x) => x.vencimento)).toEqual(['2026-03-10']);
    expect(competenciasDevidas(t, '2026-02-15')).toEqual([]);
  });
});
