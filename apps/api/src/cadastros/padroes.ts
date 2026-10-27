import type { PoolClient } from 'pg';
import { FORMAS_PAGAMENTO_PADRAO, PLANO_CONTAS_PADRAO } from '@ecv/shared';

/** Plano de contas e formas de pagamento iniciais de um grupo. Idempotente: só semeia o que está vazio. */
export async function semearPadroes(c: PoolClient, grupoId: string): Promise<{ plano: number; formas: number }> {
  let plano = 0;
  let formas = 0;
  if (Number((await c.query('SELECT count(*) AS n FROM plano_conta')).rows[0].n) === 0) {
    const ids = new Map<string, string>();
    for (const conta of PLANO_CONTAS_PADRAO) {
      const paiCodigo = conta.codigo.includes('.') ? conta.codigo.slice(0, conta.codigo.lastIndexOf('.')) : null;
      const r = await c.query(
        'INSERT INTO plano_conta (grupo_id, codigo, nome, tipo, pai_id, aceita_lancamento) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [grupoId, conta.codigo, conta.nome, conta.tipo, paiCodigo ? ids.get(paiCodigo) : null, conta.aceitaLancamento],
      );
      ids.set(conta.codigo, r.rows[0].id);
      plano++;
    }
  }
  if (Number((await c.query('SELECT count(*) AS n FROM forma_pagamento')).rows[0].n) === 0) {
    for (const f of FORMAS_PAGAMENTO_PADRAO) {
      await c.query('INSERT INTO forma_pagamento (grupo_id, nome, tipo, gera_fatura) VALUES ($1,$2,$3,$4)', [grupoId, f.nome, f.tipo, f.geraFatura]);
      formas++;
    }
  }
  return { plano, formas };
}
