import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { AcessoAtual, Requer } from '../common/decorators';
import { Acesso, contextoDb } from '../common/acesso';
import { validar } from '../common/zod';

const filtro = z.object({
  entidade: z.string().max(60).optional(),
  entidadeId: z.string().max(80).optional(),
  desde: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  antesDoId: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly db: DbService) {}

  /** O isolamento por grupo e por loja é do banco: o Gerente só recebe eventos das lojas dele. */
  @Get() @Requer('auditoria.ver')
  async listar(@AcessoAtual() a: Acesso, @Query() q: unknown) {
    const f = validar(filtro, q);
    const rows = await this.db.tenant(contextoDb(a), async (c) =>
      (await c.query(
        `SELECT l.id, l.criado_em AS "criadoEm", l.acao, l.entidade, l.entidade_id AS "entidadeId", l.empresa_id AS "empresaId",
                l.usuario_id AS "usuarioId", u.nome AS usuario, l.antes, l.depois, l.motivo
           FROM auditoria_log l LEFT JOIN usuario u ON u.id = l.usuario_id
          WHERE ($1::text IS NULL OR l.entidade = $1) AND ($2::text IS NULL OR l.entidade_id = $2)
            AND ($3::timestamptz IS NULL OR l.criado_em >= $3) AND ($4::timestamptz IS NULL OR l.criado_em <= $4)
            AND ($5::bigint IS NULL OR l.id < $5)
          ORDER BY l.id DESC LIMIT $6`,
        [f.entidade ?? null, f.entidadeId ?? null, f.desde ?? null, f.ate ?? null, f.antesDoId ?? null, f.limite],
      )).rows,
    );
    return { itens: rows, proximoAntesDoId: rows.length === f.limite ? rows[rows.length - 1].id : null };
  }
}
