import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Chave de 32 bytes (base64) em CHAVE_SEGREDOS. Cifra o segredo do 2FA e assina os tickets do backoffice. */
export class Cripto {
  private readonly chave: Buffer;
  constructor(chaveBase64: string) {
    this.chave = Buffer.from(chaveBase64, 'base64');
    if (this.chave.length !== 32) throw new Error('CHAVE_SEGREDOS deve ter 32 bytes em base64.');
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chave, iv);
    const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64url');
  }

  decifrar(token: string): string {
    const b = Buffer.from(token, 'base64url');
    const d = createDecipheriv('aes-256-gcm', this.chave, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }

  /** Ticket assinado e com validade: base64url(payload).assinatura */
  assinar(payload: Record<string, unknown>, validadeSeg: number): string {
    const corpo = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + validadeSeg })).toString('base64url');
    return `${corpo}.${this.mac(corpo)}`;
  }

  verificar<T extends Record<string, unknown>>(ticket: string): T | null {
    const [corpo, mac] = ticket.split('.');
    if (!corpo || !mac) return null;
    const esperado = Buffer.from(this.mac(corpo));
    const recebido = Buffer.from(mac);
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
    try {
      const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as T & { exp: number };
      return p.exp > Math.floor(Date.now() / 1000) ? p : null;
    } catch {
      return null;
    }
  }

  private mac(corpo: string) {
    return createHmac('sha256', this.chave).update(corpo).digest('base64url');
  }
}
