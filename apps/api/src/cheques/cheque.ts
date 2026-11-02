import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export interface DadosCheque { numero: string; banco?: string | null; emitente: string; bomPara: string }

export async function criarCheque(c: PoolClient, grupoId: string, d: { empresaId: string; baixaId: string; valorCentavos: number; cheque: DadosCheque }) {
  await c.query(
    `INSERT INTO cheque (grupo_id, empresa_id, baixa_id, numero, banco, emitente, bom_para, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [grupoId, d.empresaId, d.baixaId, d.cheque.numero, d.cheque.banco ?? null, d.cheque.emitente, d.cheque.bomPara, d.valorCentavos]);
}

/** Estornar a baixa de um cheque que ainda está na mão cancela o cheque; depois de depositado, o caminho é registrar a devolução. */
export async function cancelarChequeDaBaixa(c: PoolClient, baixaId: string): Promise<void> {
  const ch = (await c.query('SELECT id, status FROM cheque WHERE baixa_id = $1 FOR UPDATE', [baixaId])).rows[0];
  if (!ch) return;
  if (ch.status === 'DEPOSITADO' || ch.status === 'COMPENSADO') throw new ConflictException('Este cheque já foi depositado. Registre a devolução do cheque (tela Cheques) em vez de estornar a baixa.');
  await c.query(`UPDATE cheque SET status = 'CANCELADO' WHERE id = $1 AND status = 'RECEBIDO'`, [ch.id]);
}
