import { Body, Controller, Get, Put } from '@nestjs/common';
import { temaSchema } from '@ecv/shared';
import { TemaService } from './tema.service';
import { AcessoAtual, Requer } from '../common/decorators';
import { Acesso } from '../common/acesso';
import { validar } from '../common/zod';

@Controller('tema')
export class TemaController {
  constructor(private readonly svc: TemaService) {}

  @Get() obter(@AcessoAtual() a: Acesso) { return this.svc.efetivo(a); }

  @Put() @Requer('tema.editar')
  salvar(@AcessoAtual() a: Acesso, @Body() body: unknown) { return this.svc.salvar(a, validar(temaSchema, body)); }
}
