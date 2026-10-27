import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permissao } from '@ecv/shared';
import type { Acesso } from './acesso';

export const PUBLICO = 'publico';
export const PERMISSAO = 'permissao';

/** Rota sem login. */
export const Publico = () => SetMetadata(PUBLICO, true);
/** Exige que o perfil do usuário na loja ativa tenha a permissão (a regra fina por loja fica no serviço). */
export const Requer = (permissao: Permissao) => SetMetadata(PERMISSAO, permissao);

export const AcessoAtual = createParamDecorator((_: unknown, ctx: ExecutionContext): Acesso => {
  return ctx.switchToHttp().getRequest().acesso as Acesso;
});
