import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

export const hashSenha = (s: string) => hash(s); // argon2id, parâmetros padrão da biblioteca

export async function conferirSenha(hashGuardado: string | null, senha: string): Promise<boolean> {
  // Sem hash (usuário inexistente ou convite pendente) ainda gasta o mesmo tempo, para não revelar quem existe.
  const alvo = hashGuardado ?? (await hashFalso());
  try {
    const ok = await verify(alvo, senha);
    return ok && hashGuardado !== null;
  } catch {
    return false;
  }
}

let falso: Promise<string> | null = null;
const hashFalso = () => (falso ??= hash(randomBytes(16).toString('hex')));

export const sha256 = (s: string) => createHash('sha256').update(s).digest();
export const novoToken = () => randomBytes(32).toString('base64url');
