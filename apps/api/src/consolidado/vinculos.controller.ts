import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { VinculosService } from './vinculos.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual } from '../common/decorators';
import { validar } from '../common/zod';

const schema = z.object({ tipo: z.enum(['cliente', 'fornecedor']), id: z.string().uuid(), empresaVinculadaId: z.union([z.string().uuid(), z.null()]) });

@Controller('grupo')
export class VinculosController {
  constructor(private readonly svc: VinculosService) {}
  @Get('vinculos') listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }
  @Put('vinculos') definir(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.definir(a, validar(schema, b)); }
}
