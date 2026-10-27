import { ForbiddenException, SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { temPermissaoInterna, type PapelInterno, type PermissaoInterna } from '@ecv/shared';

export interface AcessoInterno {
  sessaoId: string;
  id: string;
  nome: string;
  email: string;
  papel: PapelInterno;
  ip?: string;
  userAgent?: string;
}

export const PERMISSAO_INTERNA = 'permissao_interna';
export const RequerInterno = (p: PermissaoInterna) => SetMetadata(PERMISSAO_INTERNA, p);
export const Interno = createParamDecorator((_: unknown, ctx: ExecutionContext): AcessoInterno => ctx.switchToHttp().getRequest().interno);

export function exigirInterno(a: AcessoInterno, p: PermissaoInterna) {
  if (!temPermissaoInterna(a.papel, p)) throw new ForbiddenException('Seu perfil interno não tem permissão para esta ação.');
}
