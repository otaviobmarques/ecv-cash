import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  assinaturaSaasEdicaoSchema, assinaturaSaasSchema, baixarCobrancaSaasSchema, cancelarAssinaturaSchema, cancelarCobrancaSaasSchema, planoSaasEdicaoSchema, planoSaasSchema,
} from '@ecv/shared';
import { AcessoAtual, Publico, Requer } from '../common/decorators';
import type { Acesso } from '../common/acesso';
import { validar } from '../common/zod';
import { BoGuard } from '../backoffice/bo.guard';
import { Interno, RequerInterno, type AcessoInterno } from '../backoffice/bo-acesso';
import { AssinaturaService } from './assinatura.service';

/** Equipe ECV Cash: planos, contratos e mensalidades de todos os clientes. */
@Publico()
@UseGuards(BoGuard)
@Controller('backoffice')
export class AssinaturaBoController {
  constructor(private readonly svc: AssinaturaService) {}

  @Get('planos') @RequerInterno('assinatura.ver') planos() { return this.svc.listarPlanos(); }
  @Post('planos') @RequerInterno('plano.gerir') criarPlano(@Body() b: unknown) { return this.svc.criarPlano(validar(planoSaasSchema, b)); }
  @Patch('planos/:id') @RequerInterno('plano.gerir') editarPlano(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editarPlano(id, validar(planoSaasEdicaoSchema, b)); }

  @Get('assinaturas') @RequerInterno('assinatura.ver') assinaturas() { return this.svc.listarAssinaturasGlobal(); }
  @Get('cobrancas') @RequerInterno('assinatura.ver')
  cobrancas(@Query('status') status?: string, @Query('grupoId') grupoId?: string, @Query('vencidas') vencidas?: string) {
    return this.svc.listarCobrancasGlobal({ status: status || undefined, grupoId: grupoId || undefined, vencidas: vencidas === 'true' });
  }

  @Get('grupos/:id/assinatura') @RequerInterno('assinatura.ver') obter(@Param('id', ParseUUIDPipe) id: string) { return this.svc.obter(id); }
  @Post('grupos/:id/assinatura') @RequerInterno('assinatura.gerir')
  contratar(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.contratar(i, id, validar(assinaturaSaasSchema, b)); }
  @Patch('grupos/:id/assinatura') @RequerInterno('assinatura.gerir')
  editar(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editar(i, id, validar(assinaturaSaasEdicaoSchema, b)); }
  @Post('grupos/:id/assinatura/cancelar') @RequerInterno('assinatura.gerir')
  cancelar(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.cancelar(i, id, validar(cancelarAssinaturaSchema, b).motivo); }
  @Post('grupos/:id/assinatura/gerar') @RequerInterno('assinatura.gerir')
  gerar(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string) { return this.svc.gerarAgora(i, id); }
  @Post('grupos/:id/cobrancas/:cid/baixar') @RequerInterno('assinatura.baixar')
  baixar(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() b: unknown) {
    return this.svc.baixar(i, id, cid, validar(baixarCobrancaSaasSchema, b));
  }
  @Post('grupos/:id/cobrancas/:cid/cancelar') @RequerInterno('assinatura.baixar')
  cancelarCobranca(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() b: unknown) {
    return this.svc.cancelarCobranca(i, id, cid, validar(cancelarCobrancaSaasSchema, b).motivo);
  }
}

/** O Administrativo do cliente vê a própria assinatura e as mensalidades. */
@Controller('assinatura')
export class AssinaturaController {
  constructor(private readonly svc: AssinaturaService) {}
  @Get() @Requer('assinatura.ver') minha(@AcessoAtual() a: Acesso) { return this.svc.minha(a); }
  @Get('aviso') aviso(@AcessoAtual() a: Acesso) { return this.svc.aviso(a); }
}
