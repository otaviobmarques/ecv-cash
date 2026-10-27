import { createHmac, randomBytes } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Codificar(buf: Buffer): string {
  let bits = 0, valor = 0, saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { saida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function base32Decodificar(s: string): Buffer {
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('Segredo inválido.');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const novoSegredoTotp = () => base32Codificar(randomBytes(20));

/** RFC 6238 (SHA-1, 30 s, 6 dígitos). */
export function codigoTotp(segredo: string, passo: number, digitos = 6): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', base32Decodificar(segredo)).update(contador).digest();
  const off = h[h.length - 1]! & 15;
  const n = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

export const passoAtual = (agoraMs = Date.now()) => Math.floor(agoraMs / 30_000);

/** Aceita o passo atual e um para cada lado (relógios levemente fora). Devolve o passo que bateu ou null. */
export function verificarTotp(segredo: string, codigo: string, agoraMs = Date.now()): number | null {
  const p = passoAtual(agoraMs);
  for (const d of [0, -1, 1]) if (codigoTotp(segredo, p + d) === codigo) return p + d;
  return null;
}

export const uriTotp = (segredo: string, email: string, emissor = 'ECV Cash') =>
  `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(email)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&digits=6&period=30`;
