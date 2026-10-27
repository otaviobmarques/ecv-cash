import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { editarLaudoSchema, filtroLaudosSchema, laudoSchema, loteSchema, motivoSchema, revisarLaudoSchema, temPermissao } from '@ecv/shared';
import { LaudosService } from './laudos.service';
import { Acesso, perfilAtivo } from '../common/acesso';
import { AcessoAtual } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('laudos')
export class LaudosController {
  constructor(private readonly svc: LaudosService) {}

  @Get()
  listar(@AcessoAtual() a: Acesso, @Query() q: unknown) {
    const p = perfilAtivo(a);
    if (!p || !(temPermissao(p, 'laudo.ver') || temPermissao(p, 'laudo.ver_proprios'))) throw new ForbiddenException('Você não tem permissão para esta ação.');
    return this.svc.listar(a, validar(filtroLaudosSchema, q));
  }

  @Post() lancar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.lancar(a, validar(laudoSchema, b)); }
  @Post('lote') lote(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.lote(a, validar(loteSchema, b)); }

  @Get(':id') detalhe(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.detalhe(a, id); }
  @Patch(':id') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editar(a, id, validar(editarLaudoSchema, b)); }

  @Post(':id/solicitar-cancelamento')
  solicitar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.solicitarCancelamento(a, id, validar(motivoSchema, b).motivo); }
  @Post(':id/cancelar')
  cancelar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.cancelar(a, id, validar(motivoSchema, b).motivo); }
  @Post(':id/rejeitar-cancelamento')
  rejeitar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.rejeitarCancelamento(a, id, validar(motivoSchema, b).motivo); }
  @Post(':id/revisar')
  revisar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.revisar(a, id, validar(revisarLaudoSchema, b).promoverPreco); }
}
