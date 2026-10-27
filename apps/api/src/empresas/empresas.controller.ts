import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { criarEmpresaSchema } from '@ecv/shared';
import { EmpresasService, editarEmpresaSchema } from './empresas.service';
import { AcessoAtual, Requer } from '../common/decorators';
import { Acesso } from '../common/acesso';
import { validar } from '../common/zod';

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly svc: EmpresasService) {}

  @Get() listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }

  @Post() @Requer('empresa.criar')
  criar(@AcessoAtual() a: Acesso, @Body() body: unknown) { return this.svc.criar(a, validar(criarEmpresaSchema, body)); }

  @Patch(':id') @Requer('empresa.editar')
  editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.editar(a, id, validar(editarEmpresaSchema, body));
  }
}
