import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { derivarTema, type TemaEntrada } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';

const COLS = `empresa_id AS "empresaId", cor_primaria AS "corPrimaria", cor_secundaria AS "corSecundaria", cor_destaque AS "corDestaque", atualizado_em AS "atualizadoEm"`;
const VAZIO = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class TemaService {
  constructor(private readonly db: DbService) {}

  /** Tema que vale para a empresa ativa: o da própria empresa ou, se não houver, o do grupo. */
  async efetivo(a: Acesso) {
    const t = await this.db.tenant(contextoDb(a), async (c) =>
      (await c.query(
        `SELECT ${COLS} FROM tema WHERE empresa_id IS NOT DISTINCT FROM $1 OR empresa_id IS NULL
          ORDER BY (empresa_id IS NULL) LIMIT 1`,
        [a.empresaAtivaId],
      )).rows[0],
    );
    return t ? { ...t, escopo: t.empresaId ? 'EMPRESA' : 'GRUPO', derivado: derivarTema(t.corPrimaria) } : null;
  }

  async salvar(a: Acesso, dto: TemaEntrada) {
    let empresaId: string | null = null;
    if (dto.escopo === 'GRUPO') {
      if (!a.rede) throw new ForbiddenException('Só o Administrativo altera o tema do grupo.');
    } else {
      empresaId = dto.empresaId ?? a.empresaAtivaId;
      if (!empresaId) throw new UnprocessableEntityException({ mensagem: 'Escolha a empresa.', campos: { empresaId: 'Escolha a empresa.' } });
      exigir(a, 'tema.editar', empresaId);
    }
    const d = derivarTema(dto.corPrimaria);
    if (d.contrasteComMarfim < 3) {
      throw new UnprocessableEntityException({
        mensagem: 'Esta cor é clara demais para botões e textos. Escolha uma mais escura.',
        campos: { corPrimaria: `Contraste ${d.contrasteComMarfim}:1 com o fundo. O mínimo é 3:1.` },
      });
    }
    const cor = (h?: string) => (h ? h.toUpperCase() : null);
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${COLS} FROM tema WHERE empresa_id IS NOT DISTINCT FROM $1`, [empresaId])).rows[0] ?? null;
      const r = await c.query(
        `INSERT INTO tema (grupo_id, empresa_id, cor_primaria, cor_secundaria, cor_destaque, atualizado_por)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (grupo_id, (coalesce(empresa_id, '${VAZIO}'::uuid)))
         DO UPDATE SET cor_primaria = EXCLUDED.cor_primaria, cor_secundaria = EXCLUDED.cor_secundaria,
                       cor_destaque = EXCLUDED.cor_destaque, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()
         RETURNING ${COLS}`,
        [a.grupoId, empresaId, cor(dto.corPrimaria), cor(dto.corSecundaria), cor(dto.corDestaque), a.usuarioId],
      );
      await auditar(c, a, { acao: 'tema.salvo', entidade: 'tema', entidadeId: empresaId ?? 'grupo', empresaId, antes, depois: r.rows[0] });
      return { ...r.rows[0], escopo: empresaId ? 'EMPRESA' : 'GRUPO', derivado: d };
    });
  }
}
