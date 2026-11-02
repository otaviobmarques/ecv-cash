import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { apurarCustosSchema, editarTituloPagarSchema, estornoSchema, filtroPagarSchema, pagamentoPagarSchema, rateioSchema, recorrenciaSchema, rejeitarPagarSchema, tituloPagarSchema } from '@ecv/shared';
import { UnprocessableEntityException } from '@nestjs/common';
import { PagarService } from './pagar.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { dataIso } from '@ecv/shared';

@Controller('pagar')
export class PagarController {
  constructor(private readonly svc: PagarService) {}

  @Get('titulos') @Requer('pagar.ver') listar(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.listar(a, validar(filtroPagarSchema, q)); }
  @Get('resumo') @Requer('pagar.ver') resumo(@AcessoAtual() a: Acesso) { return this.svc.resumo(a); }
  @Get('titulos/:id') @Requer('pagar.ver') detalhe(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.detalhe(a, id); }

  @Post('titulos') @Requer('pagar.criar') criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criar(a, validar(tituloPagarSchema, b)); }
  @Patch('titulos/:id') @Requer('pagar.criar') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editar(a, id, validar(editarTituloPagarSchema, b)); }
  @Post('titulos/:id/enviar') @Requer('pagar.criar') enviar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.enviar(a, id); }
  @Post('titulos/:id/aprovar') @Requer('pagar.ver') aprovar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.aprovar(a, id); }
  @Post('titulos/:id/rejeitar') @Requer('pagar.ver') rejeitar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.rejeitar(a, id, validar(rejeitarPagarSchema, b).motivo); }
  @Post('titulos/:id/cancelar') @Requer('pagar.ver') cancelar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.cancelar(a, id, validar(estornoSchema, b).motivo); }
  @Post('titulos/:id/pagamentos') @Requer('pagar.pagar') pagar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.pagar(a, id, validar(pagamentoPagarSchema, b)); }
  @Post('pagamentos/:id/estornar') @Requer('pagar.ver') estornar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.estornarPagamento(a, id, validar(estornoSchema, b).motivo); }

  @Post('anexos') @Requer('pagar.criar') @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  anexar(@AcessoAtual() a: Acesso, @UploadedFile() arquivo?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    if (!arquivo) throw new UnprocessableEntityException({ mensagem: 'Escolha o arquivo.', campos: { arquivo: 'Escolha o arquivo.' } });
    return this.svc.guardarAnexo(a, arquivo);
  }
  @Get('anexos/:id') @Requer('pagar.ver')
  async baixarAnexo(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const x = await this.svc.lerAnexo(a, id);
    res.setHeader('Content-Type', x.mime); res.setHeader('Content-Disposition', `inline; filename="${x.nome}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.send(x.conteudo);
  }

  @Get('recorrencias') @Requer('pagar.ver') recorrencias(@AcessoAtual() a: Acesso) { return this.svc.listarRecorrencias(a); }
  @Post('recorrencias') @Requer('pagar.recorrencia') criarRecorrencia(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criarRecorrencia(a, validar(recorrenciaSchema, b)); }
  @Post('recorrencias/:id/pausar') @Requer('pagar.recorrencia') pausar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.alternarRecorrencia(a, id, false); }
  @Post('recorrencias/:id/reativar') @Requer('pagar.recorrencia') reativar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.alternarRecorrencia(a, id, true); }

  @Post('rateios') @Requer('pagar.rateio') ratear(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.ratear(a, validar(rateioSchema, b)); }

  @Get('custos-a-apurar') @Requer('pagar.criar')
  custos(@AcessoAtual() a: Acesso, @Query() q: { de?: string; ate?: string }) { return this.svc.custosAApurar(a, validar(dataIso, q.de), validar(dataIso, q.ate)); }
  @Post('custos-a-apurar') @Requer('pagar.criar') apurar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.apurarCustos(a, validar(apurarCustosSchema, b)); }
}
