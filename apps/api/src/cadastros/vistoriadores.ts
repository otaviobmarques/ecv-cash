import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { editarVistoriadorSchema, vistoriadorSchema } from '@ecv/shared';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { conflitoSe } from './comum';

/** O Gerente só mexe nas lojas em que ele é Gerente; o Administrativo em qualquer uma. */
function exigirLojas(a: Acesso, ids: string[]) {
  for (const id of ids) {
    if (perfilEm(a, id) === null) throw new ForbiddenException('Você não tem acesso a uma das lojas escolhidas.');
    exigir(a, 'vistoriador.editar', id);
  }
}

@Injectable()
export class VistoriadoresService {
  constructor(private readonly db: DbService) {}

  listar(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) =>
      (await c.query(
        `SELECT v.id, v.nome, v.cpf, v.usuario_id AS "usuarioId", v.status,
                coalesce(json_agg(ve.empresa_id) FILTER (WHERE ve.empresa_id IS NOT NULL), '[]') AS "empresaIds"
           FROM vistoriador v LEFT JOIN vistoriador_empresa ve ON ve.vistoriador_id = v.id GROUP BY v.id ORDER BY v.nome`)).rows,
    );
  }

  async criar(a: Acesso, d: ReturnType<typeof vistoriadorSchema.parse>) {
    exigirLojas(a, d.empresaIds);
    const id = randomUUID();
    return this.db.tenant(contextoDb(a), async (c) => {
      const n = Number((await c.query(`SELECT count(*) AS n FROM empresa WHERE id = ANY($1::uuid[]) AND status = 'ATIVO'`, [d.empresaIds])).rows[0].n);
      if (n !== new Set(d.empresaIds).size) throw new BadRequestException('Uma das lojas não existe ou está inativa.');
      if (d.usuarioId && !(await c.query('SELECT 1 FROM usuario WHERE id = $1', [d.usuarioId])).rows[0]) throw new BadRequestException('O usuário escolhido não existe ou não é da sua loja.');
      try {
        // sem RETURNING: o vistoriador só fica visível ao Gerente depois de receber a lotação
        await c.query('INSERT INTO vistoriador (id, grupo_id, nome, cpf, usuario_id) VALUES ($1,$2,$3,$4,$5)', [id, a.grupoId, d.nome, d.cpf ?? null, d.usuarioId ?? null]);
      } catch (e) { return conflitoSe(e, 'Já existe um vistoriador com este CPF ou este usuário.'); }
      for (const e of new Set(d.empresaIds)) await c.query('INSERT INTO vistoriador_empresa (vistoriador_id, empresa_id, grupo_id) VALUES ($1,$2,$3)', [id, e, a.grupoId]);
      const depois = { id, nome: d.nome, cpf: d.cpf ?? null, empresaIds: d.empresaIds };
      await auditar(c, a, { acao: 'vistoriador.criado', entidade: 'vistoriador', entidadeId: id, empresaId: d.empresaIds[0], depois });
      return depois;
    });
  }

  async editar(a: Acesso, id: string, d: ReturnType<typeof editarVistoriadorSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT v.id, v.nome, v.status, coalesce(json_agg(ve.empresa_id) FILTER (WHERE ve.empresa_id IS NOT NULL), '[]') AS "empresaIds"
                                     FROM vistoriador v LEFT JOIN vistoriador_empresa ve ON ve.vistoriador_id = v.id WHERE v.id = $1 GROUP BY v.id`, [id])).rows[0];
      if (!antes) throw new NotFoundException('Vistoriador não encontrado.');
      exigirLojas(a, antes.empresaIds);
      // nome e situação primeiro: depois de tirar a própria loja, o Gerente deixa de enxergar o registro
      await c.query('UPDATE vistoriador SET nome = coalesce($2, nome), status = coalesce($3::status_cadastro, status) WHERE id = $1', [id, d.nome ?? null, d.status ?? null]);
      let empresaIds: string[] = antes.empresaIds;
      if (d.empresaIds) {
        // cada um mexe só nas lojas dele: o Administrativo em todas, o Gerente nas que gerencia
        const alvo = new Set(d.empresaIds);
        const atuais = new Set<string>(antes.empresaIds);
        const minhas = (e: string) => a.rede || perfilEm(a, e) === 'GERENTE';
        const entram = [...alvo].filter((e) => !atuais.has(e) && minhas(e));
        const saem = [...atuais].filter((e) => !alvo.has(e) && minhas(e));
        exigirLojas(a, [...entram, ...saem]);
        for (const e of entram) await c.query('INSERT INTO vistoriador_empresa (vistoriador_id, empresa_id, grupo_id) VALUES ($1,$2,$3)', [id, e, a.grupoId]);
        for (const e of saem) await c.query('DELETE FROM vistoriador_empresa WHERE vistoriador_id = $1 AND empresa_id = $2', [id, e]);
        empresaIds = [...atuais].filter((e) => !saem.includes(e)).concat(entram);
      }
      const depois = { id, nome: d.nome ?? antes.nome, status: d.status ?? antes.status, empresaIds };
      await auditar(c, a, { acao: 'vistoriador.editado', entidade: 'vistoriador', entidadeId: id, empresaId: antes.empresaIds[0] ?? null, antes, depois });
      return depois;
    });
  }
}

@Controller('vistoriadores')
export class VistoriadoresController {
  constructor(private readonly svc: VistoriadoresService) {}
  @Get() @Requer('vistoriador.ver') listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }
  @Post() criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criar(a, validar(vistoriadorSchema, b)); }
  @Patch(':id') editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editar(a, id, validar(editarVistoriadorSchema, b)); }
}
