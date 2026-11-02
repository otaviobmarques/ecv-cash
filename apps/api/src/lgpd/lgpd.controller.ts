import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { estornoSchema } from '@ecv/shared';
import { LgpdService } from './lgpd.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

const anosSchema = z.object({ anos: z.coerce.number().int().min(5, 'A guarda legal é de 5 anos: o prazo mínimo é 5.').max(30).default(5) });
const loteSchema = z.object({ ids: z.array(z.string().uuid()).min(1, 'Escolha ao menos um cliente.').max(200), anos: z.number().int().min(5).max(30).default(5) });

@Controller('lgpd')
export class LgpdController {
  constructor(private readonly svc: LgpdService) {}
  @Get('clientes/:id/dados') @Requer('cliente.editar') dados(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.dadosDoTitular(a, id); }
  @Post('clientes/:id/anonimizar') @Requer('cliente.editar') anonimizar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.anonimizar(a, id, validar(estornoSchema, b).motivo); }
  @Get('retencao') @Requer('cliente.editar') retencao(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.retencao(a, validar(anosSchema, q).anos); }
  @Post('retencao/anonimizar') @Requer('cliente.editar') lote(@AcessoAtual() a: Acesso, @Body() b: unknown) { const d = validar(loteSchema, b); return this.svc.anonimizarLote(a, d.ids, d.anos); }
}
