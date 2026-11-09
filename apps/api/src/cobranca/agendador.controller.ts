import { Controller, Get, Headers, Inject, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Publico } from '../common/decorators';
import { ENV, type Env } from '../config/env';
import { AgendadorCobranca } from './agendador';

/** Porta de entrada do Vercel Cron para a rotina diária. Sem `CRON_SECRET` configurado, sempre recusa. */
@Controller('interno')
export class AgendadorController {
  constructor(private readonly agendador: AgendadorCobranca, @Inject(ENV) private readonly env: Env) {}

  @Publico() @Get('agendador')
  rodar(@Headers('authorization') auth?: string) {
    const esperado = this.env.CRON_SECRET ? Buffer.from(`Bearer ${this.env.CRON_SECRET}`) : undefined;
    const recebido = Buffer.from(auth ?? '');
    if (!esperado || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new UnauthorizedException('Acesso negado.');
    return this.agendador.rodarDia();
  }
}
