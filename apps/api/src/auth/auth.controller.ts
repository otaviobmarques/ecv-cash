import { Body, Controller, HttpCode, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { aceitarConviteSchema, escolherEmpresaSchema, loginSchema, permissoesDoPerfil, trocarTicketSuporteSchema } from '@ecv/shared';
import { AuthService } from './auth.service';
import { COOKIE } from './acesso.guard';
import { AcessoAtual, Publico } from '../common/decorators';
import { Acesso, perfilAtivo } from '../common/acesso';
import { validar } from '../common/zod';
import { ENV, Env } from '../config/env';

function usuarioDto(a: Acesso) {
  const perfil = perfilAtivo(a);
  return {
    id: a.usuarioId, nome: a.nome, email: a.email, rede: a.rede,
    empresas: a.empresas, empresaAtivaId: a.empresaAtivaId,
    perfilAtivo: perfil, permissoes: perfil ? permissoesDoPerfil(perfil) : [],
    suporte: a.suporte ? { usuarioInterno: a.suporte.usuarioInterno, motivo: a.suporte.motivo, expiraEm: a.suporte.expiraEm } : null,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(ENV) private readonly env: Env) {}

  @Publico() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, senha } = validar(loginSchema, body);
    const r = await this.auth.login(email, senha, req.ip, req.headers['user-agent']);
    res.cookie(COOKIE, r.token, {
      httpOnly: true, sameSite: 'lax', secure: this.env.NODE_ENV === 'production', path: '/', expires: r.expiraEm,
    });
    return usuarioDto(r.acesso);
  }

  @Publico() @Post('suporte') @HttpCode(200)
  async suporte(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { ticket } = validar(trocarTicketSuporteSchema, body);
    const r = await this.auth.trocarTicketSuporte(ticket, req.ip, req.headers['user-agent']);
    res.cookie(COOKIE, r.token, { httpOnly: true, sameSite: 'lax', secure: this.env.NODE_ENV === 'production', path: '/', expires: r.expiraEm });
    return usuarioDto(r.acesso);
  }

  @Publico() @Post('aceitar-convite') @HttpCode(204)
  async aceitar(@Body() body: unknown) {
    const { token, senha } = validar(aceitarConviteSchema, body);
    await this.auth.aceitarConvite(token, senha);
  }

  @Post('logout') @HttpCode(204)
  async logout(@AcessoAtual() a: Acesso, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a);
    res.clearCookie(COOKIE, { path: '/' });
  }

  @Get('eu')
  eu(@AcessoAtual() a: Acesso) {
    return usuarioDto(a);
  }

  @Post('empresa-ativa') @HttpCode(200)
  async trocar(@AcessoAtual() a: Acesso, @Body() body: unknown) {
    const { empresaId } = validar(escolherEmpresaSchema, body);
    return usuarioDto(await this.auth.trocarEmpresa(a, empresaId));
  }
}
