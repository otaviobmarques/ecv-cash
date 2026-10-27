import { UnprocessableEntityException } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

export function validar<T extends ZodTypeAny>(schema: T, dados: unknown): z.infer<T> {
  const r = schema.safeParse(dados);
  if (r.success) return r.data;
  const campos: Record<string, string> = {};
  for (const i of r.error.issues) campos[i.path.join('.') || '_'] ??= i.message;
  throw new UnprocessableEntityException({ mensagem: 'Confira os campos e tente de novo.', campos });
}
