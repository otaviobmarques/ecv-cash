import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ajusteCaixaSchema, estornoSchema, fecharDiaSchema, fecharPeriodoSchema, filtroExtratoSchema, reabrirSchema, transferenciaSchema } from '@ecv/shared';
import { CaixaService } from './caixa.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('caixa')
export class CaixaController {
  constructor(private readonly svc: CaixaService) {}

  @Get('contas') @Requer('caixa.ver') contas(@AcessoAtual() a: Acesso) { return this.svc.contas(a); }
  @Get('extrato') @Requer('caixa.ver') extrato(@AcessoAtual() a: Acesso, @Query() q: unknown) { const f = validar(filtroExtratoSchema, q); return this.svc.extrato(a, f.contaId, f.de, f.ate); }
  @Get('fechamentos') @Requer('caixa.ver') fechamentos(@AcessoAtual() a: Acesso, @Query('contaId') contaId?: string) { return this.svc.fechamentos(a, contaId); }

  @Post('ajustes') @Requer('caixa.ajustar') ajustar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.ajustar(a, validar(ajusteCaixaSchema, b)); }
  @Post('transferencias') @Requer('transferencia.criar') transferir(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.transferir(a, validar(transferenciaSchema, b)); }
  @Post('lancamentos/:id/estornar') @Requer('caixa.ajustar') estornar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.estornar(a, id, validar(estornoSchema, b).motivo); }

  @Post('fechar-dia') @Requer('caixa.fechar') fecharDia(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.fecharDia(a, validar(fecharDiaSchema, b)); }
  @Post('fechamentos/:id/reabrir') @Requer('caixa.reabrir_dia') reabrirDia(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.reabrirDia(a, id, validar(reabrirSchema, b).motivo); }
  @Post('fechar-periodo') @Requer('periodo.fechar') fecharPeriodo(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.fecharPeriodo(a, validar(fecharPeriodoSchema, b)); }
  @Post('periodos/:mes/reabrir') @Requer('periodo.reabrir') reabrirPeriodo(@AcessoAtual() a: Acesso, @Param('mes') mes: string, @Body() b: unknown) { return this.svc.reabrirPeriodo(a, mes, validar(reabrirSchema, b).motivo); }
}
