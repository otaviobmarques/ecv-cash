import { describe, expect, it } from 'vitest';
import { datasDaRecorrencia } from './recorrencia';

describe('datas da recorrência', () => {
  it('mensal: todo mês no dia, em mês curto vale o último dia', () => {
    expect(datasDaRecorrencia('MENSAL', 31, '2026-01-10', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('mensal: não gera antes do início', () => {
    expect(datasDaRecorrencia('MENSAL', 5, '2026-03-10', '2026-06-10')).toEqual(['2026-04-05', '2026-05-05', '2026-06-05']);
  });
  it('anual: mesmo mês de cada ano; 29 de fevereiro cai no último dia em ano comum', () => {
    expect(datasDaRecorrencia('ANUAL', 29, '2027-02-01', '2029-12-31')).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
  });
  it('semanal e quinzenal: a partir do primeiro dia da semana escolhida', () => {
    expect(datasDaRecorrencia('SEMANAL', 1, '2026-11-02', '2026-11-23')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']); // segundas
    expect(datasDaRecorrencia('QUINZENAL', 5, '2026-11-02', '2026-12-10')).toEqual(['2026-11-06', '2026-11-20', '2026-12-04']); // sextas
  });
  it('sem datas quando o limite vem antes do início', () => {
    expect(datasDaRecorrencia('MENSAL', 10, '2026-12-01', '2026-11-30')).toEqual([]);
  });
});
