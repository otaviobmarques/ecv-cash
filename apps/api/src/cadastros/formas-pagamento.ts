import { Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { editarFormaPagamentoSchema, formaEmpresaSchema, formaPagamentoSchema, temPermissao } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilAtivo } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { conflitoSe } from './comum';

const COLS = `id, nome, tipo, gera_fatura AS "geraFatura", status`;

@Injectable()
export class FormasPagamentoService {
  constructor(private readonly db: DbService) {}

  /** O Vistoriador vê só as formas ativas, com nome e tipo. Os demais veem também taxa e prazo das lojas a que têm acesso. */
  async listar(a: Acesso) {
    const completo = temPermissao(perfilAtivo(a)!, 'forma_pagamento.editar') || temPermissao(perfilAtivo(a)!, 'forma_pagamento_empresa.editar') || perfilAtivo(a) === 'FINANCEIRO';
    return this.db.tenant(contextoDb(a), async (c) => {
      if (!completo) return (await c.query(`SELECT id, nome, tipo FROM forma_pagamento WHERE status = 'ATIVO' ORDER BY nome`)).rows;
      const formas = (await c.query(`SELECT ${COLS} FROM forma_pagamento ORDER BY nome`)).rows;
      const lojas = (await c.query(`SELECT forma_id AS "formaId", empresa_id AS "empresaId", taxa_bp AS "taxaBp", prazo_dias AS "prazoDias", antecipacao_bp AS "antecipacaoBp" FROM forma_pagamento_empresa`)).rows;
      return formas.map((f) => ({ ...f, empresas: lojas.filter((l) => l.formaId === f.id) }));
    });
  }

  async criar(a: Acesso, d: ReturnType<typeof formaPagamentoSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      try {
        const r = await c.query(`INSERT INTO forma_pagamento (grupo_id, nome, tipo, gera_fatura) VALUES ($1,$2,$3,$4) RETURNING ${COLS}`, [a.grupoId, d.nome, d.tipo, d.geraFatura]);
        await auditar(c, a, { acao: 'forma_pagamento.criada', entidade: 'forma_pagamento', entidadeId: r.rows[0].id, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe uma forma de pagamento com este nome.'); }
    });
  }

  async editar(a: Acesso, id: string, d: ReturnType<typeof editarFormaPagamentoSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${COLS} FROM forma_pagamento WHERE id = $1`, [id])).rows[0];
      if (!antes) throw new NotFoundException('Forma de pagamento não encontrada.');
      try {
        const r = await c.query(`UPDATE forma_pagamento SET nome = coalesce($2, nome), status = coalesce($3::status_cadastro, status) WHERE id = $1 RETURNING ${COLS}`, [id, d.nome ?? null, d.status ?? null]);
        await auditar(c, a, { acao: 'forma_pagamento.editada', entidade: 'forma_pagamento', entidadeId: id, antes, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe uma forma de pagamento com este nome.'); }
    });
  }

  async definirPorEmpresa(a: Acesso, formaId: string, empresaId: string, d: ReturnType<typeof formaEmpresaSchema.parse>) {
    exigir(a, 'forma_pagamento_empresa.editar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      if (!(await c.query('SELECT 1 FROM forma_pagamento WHERE id = $1', [formaId])).rows[0]) throw new NotFoundException('Forma de pagamento não encontrada.');
      if (!(await c.query('SELECT 1 FROM empresa WHERE id = $1', [empresaId])).rows[0]) throw new NotFoundException('Empresa não encontrada.');
      const antes = (await c.query('SELECT taxa_bp AS "taxaBp", prazo_dias AS "prazoDias", antecipacao_bp AS "antecipacaoBp" FROM forma_pagamento_empresa WHERE forma_id = $1 AND empresa_id = $2', [formaId, empresaId])).rows[0] ?? null;
      const r = await c.query(
        `INSERT INTO forma_pagamento_empresa (grupo_id, forma_id, empresa_id, taxa_bp, prazo_dias, antecipacao_bp) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (forma_id, empresa_id) DO UPDATE SET taxa_bp = EXCLUDED.taxa_bp, prazo_dias = EXCLUDED.prazo_dias, antecipacao_bp = EXCLUDED.antecipacao_bp, atualizado_em = now()
         RETURNING forma_id AS "formaId", empresa_id AS "empresaId", taxa_bp AS "taxaBp", prazo_dias AS "prazoDias", antecipacao_bp AS "antecipacaoBp"`,
        [a.grupoId, formaId, empresaId, d.taxaBp, d.prazoDias, d.antecipacaoBp],
      );
      await auditar(c, a, { acao: 'forma_pagamento_empresa.salva', entidade: 'forma_pagamento', entidadeId: formaId, empresaId, antes, depois: r.rows[0] });
      return r.rows[0];
    });
  }
}

@Controller('formas-pagamento')
export class FormasPagamentoController {
  constructor(private readonly svc: FormasPagamentoService) {}
  @Get() @Requer('forma_pagamento.ver') listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }
  @Post() criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { exigir(a, 'forma_pagamento.editar'); return this.svc.criar(a, validar(formaPagamentoSchema, b)); }
  @Patch(':id') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { exigir(a, 'forma_pagamento.editar'); return this.svc.editar(a, id, validar(editarFormaPagamentoSchema, b)); }
  @Put(':id/empresas/:empresaId')
  porEmpresa(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Param('empresaId', ParseUUIDPipe) e: string, @Body() b: unknown) { return this.svc.definirPorEmpresa(a, id, e, validar(formaEmpresaSchema, b)); }
}
