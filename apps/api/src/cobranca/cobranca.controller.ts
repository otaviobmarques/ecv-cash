import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CobrancaService } from './cobranca.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

const reguaSchema = z.object({
  ativa: z.boolean().optional(), enviarAoGerar: z.boolean().optional(),
  diasAntes: z.array(z.number().int()).optional(), diasApos: z.array(z.number().int()).optional(),
  copiaPara: z.union([z.string().trim().max(160), z.null()]).optional(),
});
const envioSchema = z.object({ para: z.array(z.string().trim().max(160)).max(5).optional() });

@Controller()
export class CobrancaController {
  constructor(private readonly svc: CobrancaService) {}
  @Get('cobranca/regua') @Requer('receber.ver') regua(@AcessoAtual() a: Acesso) { return this.svc.regua(a); }
  @Put('cobranca/regua') @Requer('regua_cobranca.editar') salvar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.salvarRegua(a, validar(reguaSchema, b)); }
  @Post('cobranca/processar') @Requer('regua_cobranca.editar') processar(@AcessoAtual() a: Acesso) { return this.svc.processar(a); }
  @Get('cobranca/envios') @Requer('receber.ver') envios(@AcessoAtual() a: Acesso, @Query('faturaId') faturaId?: string) { return this.svc.envios(a, faturaId); }
  @Post('faturas/:id/enviar-email') @Requer('fatura.gerar') enviar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.enviarFatura(a, id, validar(envioSchema, b).para); }
}
