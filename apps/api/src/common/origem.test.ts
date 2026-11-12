import { describe, expect, it } from 'vitest';
import { origemPermitida } from './origem';

describe('origens permitidas', () => {
  const ok = origemPermitida(['https://ecv-cash-app.vercel.app', 'https://ecv-cash-*-redbox6.vercel.app']);
  it('aceita a exata e os endereços da Vercel do mesmo time', () => {
    expect(ok('https://ecv-cash-app.vercel.app')).toBe(true);
    expect(ok('https://ecv-cash-app-redbox6.vercel.app')).toBe(true);
    expect(ok('https://ecv-cash-q391n6moq-redbox6.vercel.app')).toBe(true);
    expect(ok('https://ecv-cash-admin-git-main-redbox6.vercel.app')).toBe(true);
  });
  it('recusa o resto', () => {
    expect(ok('https://ecv-cash-app.vercel.app.evil.com')).toBe(false);
    expect(ok('https://evil.com/ecv-cash-x-redbox6.vercel.app')).toBe(false);
    expect(ok('https://ecv-cash-x.evil-redbox6.vercel.app')).toBe(false);
    expect(ok('http://ecv-cash-app-redbox6.vercel.app')).toBe(false);
    expect(ok('https://outro-redbox6.vercel.app')).toBe(false);
  });
});
