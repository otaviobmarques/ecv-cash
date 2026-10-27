import { ConflictException } from '@nestjs/common';

/** Traduz violação de unicidade do banco numa mensagem que o usuário entende. */
export function conflitoSe(e: unknown, mensagem: string, restricao?: string): never {
  const err = e as { code?: string; constraint?: string };
  if (err?.code === '23505' && (!restricao || err.constraint === restricao)) throw new ConflictException(mensagem);
  throw e;
}

export const ROTULO_STATUS = { ATIVO: 'ATIVO', INATIVO: 'INATIVO' } as const;
