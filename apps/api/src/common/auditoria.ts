import type { PoolClient } from 'pg';
import type { Acesso } from './acesso';

export interface EventoAuditoria {
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  empresaId?: string | null;
  antes?: unknown;
  depois?: unknown;
  motivo?: string;
}

/** Grava na mesma transação da alteração: se a alteração falha, o registro também não existe. */
export async function auditar(c: PoolClient, a: Pick<Acesso, 'grupoId' | 'usuarioId' | 'ip' | 'userAgent'>, e: EventoAuditoria) {
  await c.query(
    `INSERT INTO auditoria_log (grupo_id, empresa_id, usuario_id, acao, entidade, entidade_id, antes, depois, motivo, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [a.grupoId, e.empresaId ?? null, a.usuarioId, e.acao, e.entidade, e.entidadeId ?? null,
     e.antes === undefined ? null : JSON.stringify(e.antes), e.depois === undefined ? null : JSON.stringify(e.depois),
     e.motivo ?? null, a.ip ?? null, a.userAgent ?? null],
  );
}
