import { Body, Controller, Get, Put } from '@nestjs/common';
import { saldoManualSchema } from '@ecv/shared';
import { SaldosService } from './saldos.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('balanco')
export class BalancoController {
  constructor(private readonly svc: SaldosService) {}
  @Get('saldos') listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }
  @Put('saldos') salvar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.salvar(a, validar(saldoManualSchema, b)); }
}
