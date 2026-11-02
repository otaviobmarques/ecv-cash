import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { calcularComissao } from '@ecv/shared';

/** Regra mais específica que vale para o laudo: vistoriador e serviço vencem "todos"; empate, a de vigência mais recente. */
export async function regraDoLaudo(c: PoolClient, d: { empresaId: string; vistoriadorId: string; servicoId: string; data: string }) {
  return (await c.query(
    `SELECT id, tipo, percentual_bp AS "percentualBp", valor_centavos AS "valorCentavos", devida_em AS "devidaEm" FROM regra_comissao
      WHERE empresa_id = $1 AND ativa AND vigencia_ini <= $4 AND (vigencia_fim IS NULL OR vigencia_fim >= $4)
        AND (vistoriador_id IS NULL OR vistoriador_id = $2) AND (servico_id IS NULL OR servico_id = $3)
      ORDER BY (vistoriador_id IS NOT NULL)::int * 2 + (servico_id IS NOT NULL)::int DESC, vigencia_ini DESC, criado_em DESC LIMIT 1`,
    [d.empresaId, d.vistoriadorId, d.servicoId, d.data])).rows[0] as { id: string; tipo: 'PERCENTUAL' | 'VALOR'; percentualBp: number | null; valorCentavos: number | null; devidaEm: 'EMISSAO' | 'RECEBIMENTO' } | undefined;
}

/** A comissão de um laudo que já entrou em fechamento não muda sem cancelar o fechamento antes. */
export async function exigirComissaoAberta(c: PoolClient, laudoId: string): Promise<void> {
  if ((await c.query('SELECT 1 FROM laudo_comissao WHERE laudo_id = $1 AND ativo AND fechamento_id IS NOT NULL', [laudoId])).rows[0]) {
    throw new ConflictException('A comissão deste laudo já foi fechada. Cancele o fechamento de comissões antes de alterar o laudo.');
  }
}

/** Grava (ou regrava) a comissão do laudo com o valor cobrado de agora. As anteriores ficam inativas, como os custos. */
export async function gravarComissao(c: PoolClient, grupoId: string, laudoId: string): Promise<void> {
  const l = (await c.query(`SELECT empresa_id AS "empresaId", vistoriador_id AS "vistoriadorId", servico_id AS "servicoId", data_laudo::text AS data, valor_cobrado_centavos AS valor FROM laudo WHERE id = $1`, [laudoId])).rows[0];
  await c.query('UPDATE laudo_comissao SET ativo = false WHERE laudo_id = $1 AND ativo', [laudoId]);
  const r = await regraDoLaudo(c, { empresaId: l.empresaId, vistoriadorId: l.vistoriadorId, servicoId: l.servicoId, data: l.data });
  if (!r) return;
  await c.query(
    `INSERT INTO laudo_comissao (grupo_id, empresa_id, laudo_id, vistoriador_id, regra_id, tipo, percentual_bp, valor_regra_centavos, valor_centavos, devida_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [grupoId, l.empresaId, laudoId, l.vistoriadorId, r.id, r.tipo, r.percentualBp, r.valorCentavos, calcularComissao(r, l.valor), r.devidaEm]);
}

export async function desativarComissao(c: PoolClient, laudoId: string): Promise<void> {
  await c.query('UPDATE laudo_comissao SET ativo = false WHERE laudo_id = $1 AND ativo', [laudoId]);
}
