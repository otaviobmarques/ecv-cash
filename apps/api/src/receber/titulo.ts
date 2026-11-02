import type { PoolClient } from 'pg';

/** Cria o título do laudo recém-lançado. Laudo de valor zero (cortesia) não gera título. */
export async function criarTituloDoLaudo(c: PoolClient, laudoId: string): Promise<string | null> {
  const r = await c.query(
    `INSERT INTO titulo_receber (grupo_id, empresa_id, laudo_id, cliente_id, forma_pagamento_id, valor_centavos, vencimento)
     SELECT l.grupo_id, l.empresa_id, l.id, l.cliente_id, l.forma_pagamento_id, l.valor_cobrado_centavos,
            CASE WHEN f.gera_fatura THEN l.data_laudo + cl.prazo_dias ELSE l.data_laudo END
       FROM laudo l JOIN forma_pagamento f ON f.id = l.forma_pagamento_id JOIN cliente cl ON cl.id = l.cliente_id
      WHERE l.id = $1 AND l.valor_cobrado_centavos > 0
     RETURNING id`, [laudoId]);
  return r.rows[0]?.id ?? null;
}

/** Depois de editar o laudo (que não está travado: sem baixa nem fatura), o título acompanha valor, cliente, forma e vencimento. */
export async function sincronizarTituloDoLaudo(c: PoolClient, laudoId: string): Promise<void> {
  const l = (await c.query(`SELECT valor_cobrado_centavos AS valor FROM laudo WHERE id = $1`, [laudoId])).rows[0];
  const t = (await c.query(`SELECT id, status FROM titulo_receber WHERE laudo_id = $1 FOR UPDATE`, [laudoId])).rows[0];
  if (!t) { if (l.valor > 0) await criarTituloDoLaudo(c, laudoId); return; }
  if (l.valor === 0) {
    await c.query(`UPDATE titulo_receber SET status = 'CANCELADO', cancelado_em = now(), motivo_cancelamento = 'Laudo passou a valor zero' WHERE id = $1`, [t.id]);
    return;
  }
  await c.query(
    `UPDATE titulo_receber t SET cliente_id = l.cliente_id, forma_pagamento_id = l.forma_pagamento_id, valor_centavos = l.valor_cobrado_centavos,
            vencimento = CASE WHEN f.gera_fatura THEN l.data_laudo + cl.prazo_dias ELSE l.data_laudo END,
            status = 'ABERTO', cancelado_em = NULL, motivo_cancelamento = NULL
       FROM laudo l JOIN forma_pagamento f ON f.id = l.forma_pagamento_id JOIN cliente cl ON cl.id = l.cliente_id
      WHERE t.id = $1 AND l.id = t.laudo_id`, [t.id]);
}

export async function cancelarTituloDoLaudo(c: PoolClient, laudoId: string, motivo: string): Promise<void> {
  await c.query(`UPDATE titulo_receber SET status = 'CANCELADO', cancelado_em = now(), motivo_cancelamento = $2 WHERE laudo_id = $1 AND status <> 'CANCELADO'`, [laudoId, motivo]);
}

/** Recalcula quanto foi pago, a situação do título e se o laudo fica travado (baixa ou fatura). Chamar depois de toda baixa, estorno ou mudança de fatura. */
export async function recalcularTitulo(c: PoolClient, tituloId: string): Promise<{ pagoCentavos: number; status: string }> {
  const t = (await c.query(
    `UPDATE titulo_receber t SET
        pago_centavos = b.pago,
        status = CASE WHEN t.status = 'CANCELADO' THEN 'CANCELADO'::status_titulo WHEN b.pago = 0 THEN 'ABERTO'::status_titulo WHEN b.pago >= t.valor_centavos THEN 'QUITADO'::status_titulo ELSE 'PARCIAL'::status_titulo END
       FROM (SELECT coalesce(sum(principal_centavos), 0)::int AS pago FROM baixa_receber WHERE titulo_id = $1) b
      WHERE t.id = $1 RETURNING t.laudo_id AS "laudoId", t.pago_centavos AS "pagoCentavos", t.status, t.fatura_id AS "faturaId"`, [tituloId])).rows[0];
  if (t.faturaId) await recalcularFatura(c, t.faturaId);
  await c.query(`UPDATE laudo SET travado_em = CASE WHEN $2::boolean THEN coalesce(travado_em, now()) ELSE NULL END WHERE id = $1 AND status = 'ATIVO'`, [t.laudoId, t.pagoCentavos > 0 || t.faturaId !== null]);
  return { pagoCentavos: t.pagoCentavos, status: t.status };
}

/** A fatura acompanha os títulos: paga quando todos quitam, parcial quando algum recebeu, aberta quando nenhum. */
export async function recalcularFatura(c: PoolClient, faturaId: string): Promise<string> {
  const r = await c.query(
    `UPDATE fatura f SET status = CASE
         WHEN s.total > 0 AND s.quitados = s.total THEN 'PAGA'::status_fatura
         WHEN s.recebido > 0 THEN 'PARCIAL'::status_fatura ELSE 'ABERTA'::status_fatura END
       FROM (SELECT count(*) AS total, count(*) FILTER (WHERE status = 'QUITADO') AS quitados, coalesce(sum(pago_centavos), 0) AS recebido
               FROM titulo_receber WHERE fatura_id = $1 AND status <> 'CANCELADO') s
      WHERE f.id = $1 AND f.status <> 'CANCELADA' RETURNING f.status`, [faturaId]);
  return r.rows[0]?.status;
}
