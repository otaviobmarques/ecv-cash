import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { apuracaoComissaoSchema, editarRegraComissaoSchema, estornoSchema, fecharComissaoSchema, regraComissaoSchema } from '@ecv/shared';
import { ComissoesService } from './comissoes.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('comissoes')
export class ComissoesController {
  constructor(private readonly svc: ComissoesService) {}
  @Get('regras') @Requer('comissao.ver') regras(@AcessoAtual() a: Acesso) { return this.svc.regras(a); }
  @Post('regras') @Requer('comissao_regra.editar') criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criarRegra(a, validar(regraComissaoSchema, b)); }
  @Patch('regras/:id') @Requer('comissao_regra.editar') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editarRegra(a, id, validar(editarRegraComissaoSchema, b)); }
  @Get('apuracao') @Requer('comissao.ver') apuracao(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.apuracao(a, validar(apuracaoComissaoSchema, q)); }
  @Post('fechar') @Requer('comissao.fechar') fechar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.fechar(a, validar(fecharComissaoSchema, b)); }
  @Get('fechamentos') @Requer('comissao.ver') fechamentos(@AcessoAtual() a: Acesso) { return this.svc.fechamentos(a); }
  @Post('fechamentos/:id/cancelar') @Requer('comissao.fechar') cancelar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.cancelarFechamento(a, id, validar(estornoSchema, b).motivo); }
}
