import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { estornoSchema } from '@ecv/shared';
import { LgpdService } from './lgpd.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('lgpd')
export class LgpdController {
  constructor(private readonly svc: LgpdService) {}
  @Get('clientes/:id/dados') @Requer('cliente.editar') dados(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.dadosDoTitular(a, id); }
  @Post('clientes/:id/anonimizar') @Requer('cliente.editar') anonimizar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.anonimizar(a, id, validar(estornoSchema, b).motivo); }
}
