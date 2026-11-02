import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RelatoriosService } from './relatorios.service';
import { DashboardService } from './dashboard.service';
import { Acesso } from '../common/acesso';
import { AcessoAtual } from '../common/decorators';
import { validar } from '../common/zod';
import { dataIso } from '@ecv/shared';

const params = z.object({ de: dataIso.optional(), ate: dataIso.optional(), agrupar: z.string().max(20).optional(), formato: z.enum(['json', 'csv']).default('json') });

@Controller()
export class RelatoriosController {
  constructor(private readonly svc: RelatoriosService, private readonly painel: DashboardService) {}

  @Get('dashboard') dashboard(@AcessoAtual() a: Acesso) { return this.painel.painel(a); }
  @Get('relatorios') catalogo(@AcessoAtual() a: Acesso) { return this.svc.catalogo(a); }

  @Get('relatorios/:id')
  async relatorio(@AcessoAtual() a: Acesso, @Param('id') id: string, @Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const { formato, ...p } = validar(params, q);
    if (formato === 'csv') {
      const { nome, csv } = await this.svc.exportarCsv(a, id, p);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${nome}"`); res.setHeader('Cache-Control', 'no-store');
      return csv;
    }
    return this.svc.gerar(a, id, p);
  }
}
