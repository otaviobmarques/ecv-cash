import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { baixaSchema, configFinanceiraSchema, estornoSchema, filtroReceberSchema, loteBaixaSchema, simularBaixaSchema } from '@ecv/shared';
import { ReceberService } from './receber.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('receber')
export class ReceberController {
  constructor(private readonly svc: ReceberService) {}

  @Get('titulos') @Requer('receber.ver') listar(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.listar(a, validar(filtroReceberSchema, q)); }
  @Get('resumo') @Requer('receber.ver') resumo(@AcessoAtual() a: Acesso) { return this.svc.resumo(a); }
  @Get('titulos/:id') @Requer('receber.ver') detalhe(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.detalhe(a, id); }
  @Get('titulos/:id/simular') @Requer('receber.ver')
  simular(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Query() q: unknown) { const f = validar(simularBaixaSchema, q); return this.svc.simular(a, id, f.data, f.principalCentavos); }

  @Post('titulos/:id/baixas') @Requer('receber.baixar')
  baixar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.baixar(a, id, validar(baixaSchema, b)); }
  @Post('baixas-lote') @Requer('receber.baixar') lote(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.baixarLote(a, validar(loteBaixaSchema, b)); }
  @Post('baixas/:id/estornar') @Requer('receber.ver')
  estornar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.estornar(a, id, validar(estornoSchema, b).motivo); }

  @Get('config') @Requer('receber.ver') config(@AcessoAtual() a: Acesso) { return this.svc.config(a); }
  @Put('config') @Requer('receber.ver') salvar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.salvarConfig(a, validar(configFinanceiraSchema, b)); }
}
