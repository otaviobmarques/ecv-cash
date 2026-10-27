import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BoAuthService } from './bo-auth.service';
import { PERMISSAO_INTERNA, exigirInterno } from './bo-acesso';
import type { PermissaoInterna } from '@ecv/shared';

export const COOKIE_BO = 'ecv_bo';

@Injectable()
export class BoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: BoAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.[COOKIE_BO];
    const a = token ? await this.auth.acessoPorToken(token, req.ip, req.headers['user-agent']) : null;
    if (!a) throw new UnauthorizedException('Entre para continuar.');
    req.interno = a;
    const p = this.reflector.getAllAndOverride<PermissaoInterna | undefined>(PERMISSAO_INTERNA, [ctx.getHandler(), ctx.getClass()]);
    if (p) exigirInterno(a, p);
    return true;
  }
}
