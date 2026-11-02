import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { baixaFaturaSchema, editarFaturaSchema, estornoSchema, filtroFaturasSchema, gerarFaturasSchema, previaFaturasSchema } from '@ecv/shared';
import QRCode from 'qrcode';
import { FaturasService } from './faturas.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';

@Controller('faturas')
export class FaturasController {
  constructor(private readonly svc: FaturasService) {}

  @Get() @Requer('receber.ver') listar(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.listar(a, validar(filtroFaturasSchema, q)); }
  @Get('previa') @Requer('fatura.gerar') previa(@AcessoAtual() a: Acesso, @Query() q: unknown) { return this.svc.previa(a, validar(previaFaturasSchema, q)); }
  @Post() @Requer('fatura.gerar') gerar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.gerar(a, validar(gerarFaturasSchema, b)); }

  @Get(':id') @Requer('receber.ver') detalhe(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.detalhe(a, id); }
  @Patch(':id') @Requer('fatura.gerar') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editar(a, id, validar(editarFaturaSchema, b)); }
  @Post(':id/baixas') @Requer('receber.baixar') baixar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.baixar(a, id, validar(baixaFaturaSchema, b)); }
  @Post(':id/cancelar') @Requer('fatura.cancelar') cancelar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.cancelar(a, id, validar(estornoSchema, b).motivo); }

  /** PIX copia e cola e a imagem do QR Code (PNG em data URL) para mostrar na tela. */
  @Get(':id/pix') @Requer('receber.ver')
  async pix(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.svc.pix(a, id);
    return p.disponivel ? { ...p, qrCode: await QRCode.toDataURL(p.copiaECola, { margin: 1, width: 260, errorCorrectionLevel: 'M' }) } : p;
  }

  @Get(':id/pdf') @Requer('receber.ver')
  async pdf(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { nome, pdf } = await this.svc.pdf(a, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}
