import { Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { editarServicoSchema, servicoCustoSchema, servicoSchema, temPermissao } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilAtivo } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { conflitoSe } from './comum';

const COLS = `s.id, s.nome, s.codigo, s.conta_receita_id AS "contaReceitaId", pc.nome AS "contaReceita", s.status`;
const CUSTO = `id, servico_id AS "servicoId", descricao, tipo, valor_centavos AS "valorCentavos", percentual_bp AS "percentualBp", gera_conta_pagar AS "geraContaPagar", fornecedor_id AS "fornecedorId", status`;

@Injectable()
export class ServicosService {
  constructor(private readonly db: DbService) {}

  /** O Vistoriador só precisa do nome para escolher o serviço ao lançar; custos são de Administrativo e Gerente. */
  async listar(a: Acesso) {
    const perfil = perfilAtivo(a)!;
    const completo = temPermissao(perfil, 'servico.editar') || temPermissao(perfil, 'custo_servico.ver');
    return this.db.tenant(contextoDb(a), async (c) => {
      if (!completo) return (await c.query(`SELECT id, nome, codigo FROM servico WHERE status = 'ATIVO' ORDER BY nome`)).rows;
      const servicos = (await c.query(`SELECT ${COLS} FROM servico s LEFT JOIN plano_conta pc ON pc.id = s.conta_receita_id ORDER BY s.nome`)).rows;
      if (!temPermissao(perfil, 'custo_servico.ver')) return servicos;
      const custos = (await c.query(`SELECT ${CUSTO} FROM servico_custo ORDER BY descricao`)).rows;
      return servicos.map((s) => ({ ...s, custos: custos.filter((x) => x.servicoId === s.id) }));
    });
  }

  async criar(a: Acesso, dto: ReturnType<typeof servicoSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      try {
        const r = await c.query(
          `INSERT INTO servico (grupo_id, nome, codigo, conta_receita_id) VALUES ($1,$2,$3,$4) RETURNING id, nome, codigo, conta_receita_id AS "contaReceitaId", status`,
          [a.grupoId, dto.nome, dto.codigo ?? null, dto.contaReceitaId ?? null],
        );
        await auditar(c, a, { acao: 'servico.criado', entidade: 'servico', entidadeId: r.rows[0].id, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe um serviço com este nome.'); }
    });
  }

  async editar(a: Acesso, id: string, dto: ReturnType<typeof editarServicoSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query('SELECT id, nome, codigo, conta_receita_id AS "contaReceitaId", status FROM servico WHERE id = $1', [id])).rows[0];
      if (!antes) throw new NotFoundException('Serviço não encontrado.');
      try {
        const r = await c.query(
          `UPDATE servico SET nome = coalesce($2, nome), codigo = coalesce($3, codigo), conta_receita_id = coalesce($4, conta_receita_id), status = coalesce($5::status_cadastro, status)
            WHERE id = $1 RETURNING id, nome, codigo, conta_receita_id AS "contaReceitaId", status`,
          [id, dto.nome ?? null, dto.codigo ?? null, dto.contaReceitaId ?? null, dto.status ?? null],
        );
        await auditar(c, a, { acao: 'servico.editado', entidade: 'servico', entidadeId: id, antes, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe um serviço com este nome.'); }
    });
  }

  async criarCusto(a: Acesso, servicoId: string, dto: ReturnType<typeof servicoCustoSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      if (!(await c.query('SELECT 1 FROM servico WHERE id = $1', [servicoId])).rows[0]) throw new NotFoundException('Serviço não encontrado.');
      const r = await c.query(
        `INSERT INTO servico_custo (grupo_id, servico_id, descricao, tipo, valor_centavos, percentual_bp, gera_conta_pagar, fornecedor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CUSTO}`,
        [a.grupoId, servicoId, dto.descricao, dto.tipo, dto.tipo === 'VALOR' ? dto.valorCentavos : null, dto.tipo === 'PERCENTUAL' ? dto.percentualBp : null, dto.geraContaPagar, dto.fornecedorId ?? null],
      );
      await auditar(c, a, { acao: 'servico_custo.criado', entidade: 'servico', entidadeId: servicoId, depois: r.rows[0] });
      return r.rows[0];
    });
  }

  async editarCusto(a: Acesso, servicoId: string, custoId: string, dto: ReturnType<typeof servicoCustoSchema.parse>, status?: 'ATIVO' | 'INATIVO') {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${CUSTO} FROM servico_custo WHERE id = $1 AND servico_id = $2`, [custoId, servicoId])).rows[0];
      if (!antes) throw new NotFoundException('Custo não encontrado.');
      const r = await c.query(
        `UPDATE servico_custo SET descricao=$3, tipo=$4, valor_centavos=$5, percentual_bp=$6, gera_conta_pagar=$7, fornecedor_id=$8, status=coalesce($9::status_cadastro, status)
          WHERE id=$1 AND servico_id=$2 RETURNING ${CUSTO}`,
        [custoId, servicoId, dto.descricao, dto.tipo, dto.tipo === 'VALOR' ? dto.valorCentavos : null, dto.tipo === 'PERCENTUAL' ? dto.percentualBp : null, dto.geraContaPagar, dto.fornecedorId ?? null, status ?? null],
      );
      await auditar(c, a, { acao: 'servico_custo.editado', entidade: 'servico', entidadeId: servicoId, antes, depois: r.rows[0] });
      return r.rows[0];
    });
  }
}

@Controller('servicos')
export class ServicosController {
  constructor(private readonly svc: ServicosService) {}

  @Get() @Requer('servico.ver')
  listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }

  @Post()
  criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { exigir(a, 'servico.editar'); return this.svc.criar(a, validar(servicoSchema, b)); }

  @Patch(':id')
  editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { exigir(a, 'servico.editar'); return this.svc.editar(a, id, validar(editarServicoSchema, b)); }

  @Post(':id/custos')
  criarCusto(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { exigir(a, 'custo_servico.editar'); return this.svc.criarCusto(a, id, validar(servicoCustoSchema, b)); }

  @Patch(':id/custos/:custoId')
  editarCusto(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Param('custoId', ParseUUIDPipe) custoId: string, @Body() b: Record<string, unknown>) {
    exigir(a, 'custo_servico.editar');
    const status = b?.status === 'INATIVO' || b?.status === 'ATIVO' ? b.status : undefined;
    return this.svc.editarCusto(a, id, custoId, validar(servicoCustoSchema, b), status);
  }
}
