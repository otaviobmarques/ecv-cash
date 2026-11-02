import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { compensarChequeSchema, depositarChequeSchema, devolverChequeSchema, filtroChequeSchema } from '@ecv/shared';
import { ChequesService } from './cheques.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('cheques')
export class ChequesController {
  constructor(private readonly svc: ChequesService) {}
  @Get() @Requer('cheque.controlar') listar(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.listar(a, validar(filtroChequeSchema, q)); }
  @Post(':id/depositar') @Requer('cheque.controlar') depositar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.depositar(a, id, validar(depositarChequeSchema, b)); }
  @Post(':id/compensar') @Requer('cheque.controlar') compensar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.compensar(a, id, validar(compensarChequeSchema, b)); }
  @Post(':id/devolver') @Requer('cheque.controlar') devolver(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.devolver(a, id, validar(devolverChequeSchema, b)); }
}
