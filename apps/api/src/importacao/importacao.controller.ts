import { Controller, Get, Param, Post, Query, Res, UnprocessableEntityException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ImportacaoService, TIPOS, type TipoImportacao } from './importacao.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual } from '../common/decorators';

const tipoValido = (t: string): TipoImportacao => {
  if (!(t in TIPOS)) throw new UnprocessableEntityException({ mensagem: 'Tipo de planilha desconhecido.', campos: { tipo: 'Use clientes, fornecedores ou precos.' } });
  return t as TipoImportacao;
};

@Controller('importacao')
export class ImportacaoController {
  constructor(private readonly svc: ImportacaoService) {}

  @Get('modelo/:tipo')
  modelo(@Param('tipo') tipo: string, @Res() res: Response) {
    const t = tipoValido(tipo);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="modelo-${t}.csv"`);
    res.send(this.svc.modelo(t));
  }

  /** Sem `aplicar=1` só confere; com `aplicar=1` grava as linhas boas. */
  @Post(':tipo') @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  importar(@AcessoAtual() a: Acesso, @Param('tipo') tipo: string, @Query('aplicar') aplicar: string | undefined, @UploadedFile() arquivo?: { originalname: string; buffer: Buffer }) {
    if (!arquivo) throw new UnprocessableEntityException({ mensagem: 'Escolha o arquivo da planilha (CSV).', campos: { arquivo: 'Escolha o arquivo.' } });
    return this.svc.processar(a, tipoValido(tipo), arquivo.buffer, arquivo.originalname, aplicar === '1');
  }
}
