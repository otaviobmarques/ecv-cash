import type { PoolClient } from 'pg';

/**
 * Impostos sobre o faturamento do período, pela alíquota vigente em cada data de laudo. Só serve para o DRE: o sistema não apura imposto.
 * Cada alíquota é aplicada ao total do período em que vale (arredondado ao centavo).
 */
export async function impostosDoPeriodo(c: PoolClient, empresaId: string | string[], de: string, ate: string, base: 'COMPETENCIA' | 'CAIXA' = 'COMPETENCIA'): Promise<{ nome: string; rotulo: string; totalCentavos: number }[]> {
  const fonte = base === 'COMPETENCIA'
    ? `SELECT l.data_laudo AS data, l.valor_cobrado_centavos AS valor FROM laudo l WHERE l.empresa_id = ANY($1::uuid[]) AND l.status = 'ATIVO' AND l.data_laudo BETWEEN $2 AND $3`
    : `SELECT b.data AS data, b.principal_centavos AS valor FROM baixa_receber b WHERE b.empresa_id = ANY($1::uuid[]) AND b.data BETWEEN $2 AND $3`;
  const rows = (await c.query(
    `SELECT a.nome::text AS nome, coalesce(a.descricao, a.nome::text) AS rotulo, round(sum(f.valor::numeric * a.percentual_bp / 10000))::bigint AS total
       FROM aliquota_imposto a JOIN (${fonte}) f ON f.data BETWEEN a.vigencia_ini AND coalesce(a.vigencia_fim, 'infinity'::date)
      WHERE a.empresa_id = ANY($1::uuid[]) AND a.ativa GROUP BY a.id, a.nome, a.descricao ORDER BY 2`, [Array.isArray(empresaId) ? empresaId : [empresaId], de, ate])).rows;
  return rows.map((r) => ({ nome: r.nome, rotulo: r.rotulo === 'SIMPLES_NACIONAL' ? 'Simples Nacional' : r.rotulo, totalCentavos: Number(r.total) }));
}
