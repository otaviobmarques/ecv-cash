import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { criarGrupoSchema, entrarComoSchema, statusGrupoSchema } from '@ecv/shared';
import { Publico } from '../common/decorators';
import { validar } from '../common/zod';
import { BoGuard } from './bo.guard';
import { BoService } from './bo.service';
import { Interno, RequerInterno, type AcessoInterno } from './bo-acesso';

@Publico()
@UseGuards(BoGuard)
@Controller('backoffice')
export class BoController {
  constructor(private readonly svc: BoService) {}

  @Get('grupos') @RequerInterno('grupo.ver')
  listar() { return this.svc.listarGrupos(); }

  @Post('grupos') @RequerInterno('grupo.criar')
  criar(@Interno() i: AcessoInterno, @Body() body: unknown) { return this.svc.criarGrupo(i, validar(criarGrupoSchema, body)); }

  @Get('grupos/:id') @RequerInterno('grupo.ver')
  detalhe(@Param('id', ParseUUIDPipe) id: string) { return this.svc.detalhe(id); }

  @Patch('grupos/:id/status') @RequerInterno('grupo.suspender')
  status(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status, motivo } = validar(statusGrupoSchema, body);
    return this.svc.alterarStatus(i, id, status, motivo);
  }

  @Get('grupos/:id/auditoria') @RequerInterno('grupo.log')
  auditoria(@Param('id', ParseUUIDPipe) id: string) { return this.svc.auditoria(id); }

  @Post('grupos/:id/usuarios/:uid/redefinir-acesso') @RequerInterno('usuario.redefinir_acesso')
  redefinir(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Param('uid', ParseUUIDPipe) uid: string) {
    return this.svc.redefinirAcesso(i, id, uid);
  }

  @Post('grupos/:id/entrar-como') @RequerInterno('suporte.entrar_como')
  entrarComo(@Interno() i: AcessoInterno, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.entrarComo(i, id, validar(entrarComoSchema, body).motivo);
  }
}
