import { Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { editarFornecedorSchema, fornecedorSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { conflitoSe } from './comum';

const COLS = `id, nome, documento, tipo, email, conta_padrao_id AS "contaPadraoId", status`;

@Injectable()
export class FornecedoresService {
  constructor(private readonly db: DbService) {}

  listar(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(`SELECT ${COLS} FROM fornecedor ORDER BY nome`)).rows);
  }

  async criar(a: Acesso, d: ReturnType<typeof fornecedorSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      try {
        const r = await c.query(`INSERT INTO fornecedor (grupo_id, nome, documento, tipo, email, conta_padrao_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
          [a.grupoId, d.nome, d.documento ?? null, d.tipo, d.email ?? null, d.contaPadraoId ?? null]);
        await auditar(c, a, { acao: 'fornecedor.criado', entidade: 'fornecedor', entidadeId: r.rows[0].id, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe um fornecedor com este CPF ou CNPJ.'); }
    });
  }

  async editar(a: Acesso, id: string, d: ReturnType<typeof editarFornecedorSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${COLS} FROM fornecedor WHERE id = $1`, [id])).rows[0];
      if (!antes) throw new NotFoundException('Fornecedor não encontrado.');
      try {
        const r = await c.query(
          `UPDATE fornecedor SET nome = coalesce($2, nome), documento = coalesce($3, documento), tipo = coalesce($4::tipo_fornecedor, tipo), email = coalesce($5, email),
                  conta_padrao_id = coalesce($6, conta_padrao_id), status = coalesce($7::status_cadastro, status) WHERE id = $1 RETURNING ${COLS}`,
          [id, d.nome ?? null, d.documento ?? null, d.tipo ?? null, d.email ?? null, d.contaPadraoId ?? null, d.status ?? null]);
        await auditar(c, a, { acao: 'fornecedor.editado', entidade: 'fornecedor', entidadeId: id, antes, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe um fornecedor com este CPF ou CNPJ.'); }
    });
  }
}

@Controller('fornecedores')
export class FornecedoresController {
  constructor(private readonly svc: FornecedoresService) {}
  @Get() @Requer('fornecedor.ver') listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }
  @Post() criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { exigir(a, 'fornecedor.editar'); return this.svc.criar(a, validar(fornecedorSchema, b)); }
  @Patch(':id') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { exigir(a, 'fornecedor.editar'); return this.svc.editar(a, id, validar(editarFornecedorSchema, b)); }
}
