import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { temPermissao, type Permissao } from '@ecv/shared';
import { AuthService } from './auth.service';
import { PERMISSAO, PUBLICO } from '../common/decorators';
import { perfilAtivo } from '../common/acesso';

export const COOKIE = 'ecv_sid';

@Injectable()
export class AcessoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const alvos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, alvos)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.[COOKIE];
    const acesso = token ? await this.auth.acessoPorToken(token, req.ip, req.headers['user-agent']) : null;
    if (!acesso) throw new UnauthorizedException('Entre para continuar.');
    req.acesso = acesso;

    const exigida = this.reflector.getAllAndOverride<Permissao | undefined>(PERMISSAO, alvos);
    if (exigida) {
      const perfil = perfilAtivo(acesso);
      if (!perfil || !temPermissao(perfil, exigida)) throw new ForbiddenException('Você não tem permissão para esta ação.');
    }
    return true;
  }
}
