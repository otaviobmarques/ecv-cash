import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginInternoSchema, mfaInternoSchema, temPermissaoInterna, MATRIZ_INTERNA, type PermissaoInterna } from '@ecv/shared';
import { Publico } from '../common/decorators';
import { validar } from '../common/zod';
import { ENV, Env } from '../config/env';
import { BoAuthService } from './bo-auth.service';
import { BoGuard, COOKIE_BO } from './bo.guard';
import { Interno, type AcessoInterno } from './bo-acesso';

const permissoes = (papel: AcessoInterno['papel']) => (Object.keys(MATRIZ_INTERNA) as PermissaoInterna[]).filter((p) => temPermissaoInterna(papel, p));

@Publico()
@Controller('backoffice/auth')
export class BoAuthController {
  constructor(private readonly auth: BoAuthService, @Inject(ENV) private readonly env: Env) {}

  @Post('login') @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    const { email, senha } = validar(loginInternoSchema, body);
    return this.auth.login(email, senha, req.ip);
  }

  @Post('mfa') @HttpCode(200)
  async mfa(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { ticket, codigo } = validar(mfaInternoSchema, body);
    const r = await this.auth.mfa(ticket, codigo, req.ip, req.headers['user-agent']);
    res.cookie(COOKIE_BO, r.token, { httpOnly: true, sameSite: 'strict', secure: this.env.NODE_ENV === 'production', path: '/', expires: r.expiraEm });
    return { ...r.interno, permissoes: permissoes(r.interno.papel) };
  }

  @UseGuards(BoGuard) @Get('eu')
  eu(@Interno() a: AcessoInterno) {
    return { id: a.id, nome: a.nome, email: a.email, papel: a.papel, permissoes: permissoes(a.papel) };
  }

  @UseGuards(BoGuard) @Post('logout') @HttpCode(204)
  async logout(@Interno() a: AcessoInterno, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a);
    res.clearCookie(COOKIE_BO, { path: '/' });
  }
}
