import { describe, expect, it } from 'vitest';
import { carregarEnv } from './env';

describe('carregarEnv', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  it('ECV_PIX_TIPO vazio (como o docker-compose manda) vale como ausente', () => {
    expect(carregarEnv({ ...base, ECV_PIX_TIPO: '' }).ECV_PIX_TIPO).toBeUndefined();
  });
  it('ECV_PIX_TIPO válido passa e inválido é recusado', () => {
    expect(carregarEnv({ ...base, ECV_PIX_TIPO: 'CNPJ' }).ECV_PIX_TIPO).toBe('CNPJ');
    expect(() => carregarEnv({ ...base, ECV_PIX_TIPO: 'BOLETO' })).toThrow();
  });
});
