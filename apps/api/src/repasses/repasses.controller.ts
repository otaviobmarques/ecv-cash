import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { aliquotaSchema, apurarRepasseSchema, editarAliquotaSchema, editarRegraRepasseSchema, estornoSchema, regraRepasseSchema } from '@ecv/shared';
import { z } from 'zod';
import { RepassesService } from './repasses.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

const mesQ = z.object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o mês no formato AAAA-MM.') });

@Controller()
export class RepassesController {
  constructor(private readonly svc: RepassesService) {}
  @Get('repasses/regras') @Requer('repasse.ver') regras(@AcessoAtual() a: Acesso) { return this.svc.regras(a); }
  @Post('repasses/regras') @Requer('repasse.editar') criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criarRegra(a, validar(regraRepasseSchema, b)); }
  @Patch('repasses/regras/:id') @Requer('repasse.editar') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editarRegra(a, id, validar(editarRegraRepasseSchema, b)); }
  @Get('repasses/previa') @Requer('repasse.ver') previa(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.previa(a, validar(mesQ, q).mes); }
  @Post('repasses/apurar') @Requer('repasse.apurar') apurar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.apurar(a, validar(apurarRepasseSchema, b)); }
  @Get('repasses/apuracoes') @Requer('repasse.ver') apuracoes(@AcessoAtual() a: Acesso) { return this.svc.apuracoes(a); }
  @Post('repasses/apuracoes/:id/cancelar') @Requer('repasse.apurar') cancelar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.cancelarApuracao(a, id, validar(estornoSchema, b).motivo); }

  @Get('aliquotas') @Requer('aliquota.ver') aliquotas(@AcessoAtual() a: Acesso) { return this.svc.aliquotas(a); }
  @Post('aliquotas') @Requer('aliquota.editar') criarAliquota(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criarAliquota(a, validar(aliquotaSchema, b)); }
  @Patch('aliquotas/:id') @Requer('aliquota.editar') editarAliquota(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editarAliquota(a, id, validar(editarAliquotaSchema, b)); }
}
