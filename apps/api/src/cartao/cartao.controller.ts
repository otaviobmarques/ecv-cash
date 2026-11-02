import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { estornoSchema, filtroCartaoSchema, liquidarCartaoSchema, liquidarLoteSchema } from '@ecv/shared';
import { CartaoService } from './cartao.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('cartao')
export class CartaoController {
  constructor(private readonly svc: CartaoService) {}
  @Get('liquidacoes') @Requer('receber.ver') listar(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.listar(a, validar(filtroCartaoSchema, q)); }
  @Post('liquidacoes/lote') @Requer('receber.baixar') lote(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.liquidarLote(a, validar(liquidarLoteSchema, b)); }
  @Post('liquidacoes/:id/liquidar') @Requer('receber.baixar') liquidar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.liquidar(a, id, validar(liquidarCartaoSchema, b)); }
  @Post('liquidacoes/:id/desfazer') @Requer('receber.ver') desfazer(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.desfazer(a, id, validar(estornoSchema, b).motivo); }
}
