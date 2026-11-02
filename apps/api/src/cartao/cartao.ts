import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { aplicarBp } from '@ecv/shared';

const somarDias = (s: string, n: number) => new Date(Date.parse(s) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Venda no cartão: a taxa da operadora e a antecipação saem do valor, e o dinheiro só entra no caixa quando a operadora paga.
 * Com antecipação, a previsão é no dia seguinte; sem ela, vale o prazo da forma de pagamento na loja.
 */
export async function criarLiquidacao(c: PoolClient, grupoId: string, d: { empresaId: string; baixaId: string; formaId: string; dataVenda: string; brutoCentavos: number }) {
  const cfg = (await c.query(`SELECT taxa_bp AS "taxaBp", prazo_dias AS "prazoDias", antecipacao_bp AS "antecipacaoBp" FROM forma_pagamento_empresa WHERE forma_id = $1 AND empresa_id = $2`, [d.formaId, d.empresaId])).rows[0]
    ?? { taxaBp: 0, prazoDias: 0, antecipacaoBp: 0 };
  const taxa = aplicarBp(d.brutoCentavos, cfg.taxaBp);
  const antecipacao = aplicarBp(d.brutoCentavos, cfg.antecipacaoBp);
  const prevista = somarDias(d.dataVenda, cfg.antecipacaoBp > 0 ? 1 : cfg.prazoDias);
  await c.query(
    `INSERT INTO liquidacao_cartao (grupo_id, empresa_id, baixa_id, forma_pagamento_id, data_venda, data_prevista, bruto_centavos, taxa_bp, taxa_centavos, antecipacao_bp, antecipacao_centavos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [grupoId, d.empresaId, d.baixaId, d.formaId, d.dataVenda, prevista, d.brutoCentavos, cfg.taxaBp, taxa, cfg.antecipacaoBp, antecipacao]);
}

/** Ao estornar a baixa: venda ainda não paga pela operadora é cancelada; já paga exige desfazer a liquidação antes. */
export async function cancelarLiquidacaoDaBaixa(c: PoolClient, baixaId: string): Promise<void> {
  const l = (await c.query('SELECT id, status FROM liquidacao_cartao WHERE baixa_id = $1 FOR UPDATE', [baixaId])).rows[0];
  if (!l) return;
  if (l.status === 'LIQUIDADO') throw new ConflictException('A operadora já pagou esta venda. Desfaça a liquidação do cartão (tela Cartões) antes de estornar a baixa.');
  await c.query(`UPDATE liquidacao_cartao SET status = 'CANCELADO' WHERE id = $1`, [l.id]);
}
