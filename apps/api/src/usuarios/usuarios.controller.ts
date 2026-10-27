import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { criarUsuarioSchema } from '@ecv/shared';
import { UsuariosService } from './usuarios.service';
import { AcessoAtual } from '../common/decorators';
import { Acesso } from '../common/acesso';
import { validar } from '../common/zod';

const statusSchema = z.object({ status: z.enum(['ATIVO', 'INATIVO']), motivo: z.string().trim().min(5).max(300).optional() });

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly svc: UsuariosService) {}

  @Get() listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }

  @Post() criar(@AcessoAtual() a: Acesso, @Body() body: unknown) { return this.svc.criar(a, validar(criarUsuarioSchema, body)); }

  @Patch(':id/status')
  status(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status, motivo } = validar(statusSchema, body);
    return this.svc.alterarStatus(a, id, status, motivo);
  }
}
