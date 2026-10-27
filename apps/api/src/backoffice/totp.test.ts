import { describe, expect, it } from 'vitest';
import { base32Codificar, base32Decodificar, codigoTotp, verificarTotp } from './totp';
import { Cripto } from '../common/cripto';
import { CHAVE_DEV } from '../config/env';

describe('TOTP (RFC 6238)', () => {
  const segredo = base32Codificar(Buffer.from('12345678901234567890'));
  it('bate com os vetores oficiais da RFC (8 dígitos, depois reduzidos a 6)', () => {
    expect(codigoTotp(segredo, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(codigoTotp(segredo, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(codigoTotp(segredo, Math.floor(1234567890 / 30), 8)).toBe('89005924');
  });
  it('base32 vai e volta', () => {
    const b = Buffer.from('segredo qualquer 123');
    expect(base32Decodificar(base32Codificar(b)).equals(b)).toBe(true);
  });
  it('aceita um passo para cada lado e recusa fora da janela', () => {
    const t = 1_700_000_000_000;
    const passo = Math.floor(t / 30_000);
    expect(verificarTotp(segredo, codigoTotp(segredo, passo), t)).toBe(passo);
    expect(verificarTotp(segredo, codigoTotp(segredo, passo - 1), t)).toBe(passo - 1);
    expect(verificarTotp(segredo, codigoTotp(segredo, passo + 1), t)).toBe(passo + 1);
    expect(verificarTotp(segredo, codigoTotp(segredo, passo + 2), t)).toBeNull();
    expect(verificarTotp(segredo, '000000', t)).toBeNull();
  });
});

describe('cripto', () => {
  const c = new Cripto(CHAVE_DEV);
  it('cifra e decifra, com resultado diferente a cada vez', () => {
    const a = c.cifrar('JBSWY3DPEHPK3PXP');
    expect(c.decifrar(a)).toBe('JBSWY3DPEHPK3PXP');
    expect(c.cifrar('JBSWY3DPEHPK3PXP')).not.toBe(a);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
  });
  it('recusa dado adulterado', () => {
    const a = c.cifrar('segredo');
    const b = Buffer.from(a, 'base64url'); b[b.length - 1] = b[b.length - 1]! ^ 1;
    expect(() => c.decifrar(b.toString('base64url'))).toThrow();
  });
  it('ticket assinado vale até expirar e não aceita adulteração', () => {
    const t = c.assinar({ uid: 'x' }, 60);
    expect(c.verificar<{ uid: string }>(t)?.uid).toBe('x');
    const [corpo, mac] = t.split('.');
    const forjado = Buffer.from(JSON.stringify({ uid: 'outro', exp: 9999999999 })).toString('base64url');
    expect(c.verificar(`${forjado}.${mac}`)).toBeNull();
    expect(c.verificar(`${corpo}.${mac}x`)).toBeNull();
    expect(c.verificar(c.assinar({ uid: 'x' }, -1))).toBeNull();
  });
  it('rejeita chave que não tem 32 bytes', () => {
    expect(() => new Cripto(Buffer.alloc(8).toString('base64'))).toThrow();
  });
});
