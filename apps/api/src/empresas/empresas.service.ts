import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { criarEmpresaSchema, type CriarEmpresa } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';

export const editarEmpresaSchema = z.object({
  nomeFantasia: z.string().trim().min(2).max(120).optional(),
  cidade: z.string().trim().min(2).max(80).optional(),
  uf: z.string().trim().length(2).toUpperCase().optional(),
  emailFinanceiro: z.string().trim().toLowerCase().email().nullable().optional(),
});

const COLS = `id, cnpj, razao_social AS "razaoSocial", nome_fantasia AS "nomeFantasia", uf, cidade, regime,
              email_financeiro AS "emailFinanceiro", status`;

@Injectable()
export class EmpresasService {
  constructor(private readonly db: DbService) {}

  listar(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(`SELECT ${COLS} FROM empresa ORDER BY nome_fantasia`)).rows);
  }

  async criar(a: Acesso, dto: CriarEmpresa) {
    exigir(a, 'empresa.criar');
    return this.db.tenant(contextoDb(a), async (c) => {
      try {
        const r = await c.query(
          `INSERT INTO empresa (grupo_id, cnpj, razao_social, nome_fantasia, uf, cidade, regime, email_financeiro)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
          [a.grupoId, dto.cnpj, dto.razaoSocial, dto.nomeFantasia, dto.uf, dto.cidade, dto.regimeTributario, dto.emailFinanceiro ?? null],
        );
        await auditar(c, a, { acao: 'empresa.criada', entidade: 'empresa', entidadeId: r.rows[0].id, empresaId: r.rows[0].id, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe uma empresa com este CNPJ.');
        throw e;
      }
    });
  }

  async editar(a: Acesso, id: string, dto: z.infer<typeof editarEmpresaSchema>) {
    exigir(a, 'empresa.editar', id);
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${COLS} FROM empresa WHERE id = $1`, [id])).rows[0];
      if (!antes) throw new NotFoundException('Empresa não encontrada.');
      const novo = {
        nomeFantasia: dto.nomeFantasia ?? antes.nomeFantasia, cidade: dto.cidade ?? antes.cidade,
        uf: dto.uf ?? antes.uf, emailFinanceiro: dto.emailFinanceiro === undefined ? antes.emailFinanceiro : dto.emailFinanceiro,
      };
      const r = await c.query(
        `UPDATE empresa SET nome_fantasia=$2, cidade=$3, uf=$4, email_financeiro=$5 WHERE id=$1 RETURNING ${COLS}`,
        [id, novo.nomeFantasia, novo.cidade, novo.uf, novo.emailFinanceiro],
      );
      await auditar(c, a, { acao: 'empresa.editada', entidade: 'empresa', entidadeId: id, empresaId: id, antes, depois: r.rows[0] });
      return r.rows[0];
    });
  }
}
