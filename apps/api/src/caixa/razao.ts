import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Acesso } from '../common/acesso';

export interface NovoLancamento {
  empresaId: string; contaId: string; data: string; valorCentavos: number;
  origem: 'BAIXA_RECEBER' | 'PAGAMENTO_PAGAR' | 'TRANSFERENCIA' | 'AJUSTE' | 'LIQUIDACAO_CARTAO' | 'CHEQUE';
  origemId?: string | null; planoContaId?: string | null; descricao: string; estornoDe?: string | null; motivo?: string | null;
}

/** Única porta de entrada no razão de caixa. O banco recusa data em caixa ou mês fechado e conta de outra loja. */
export async function registrarLancamento(c: PoolClient, a: Pick<Acesso, 'grupoId' | 'usuarioId'>, l: NovoLancamento): Promise<string> {
  const conta = (await c.query(`SELECT status FROM conta_financeira WHERE id = $1 AND empresa_id = $2`, [l.contaId, l.empresaId])).rows[0];
  if (!conta) throw new NotFoundException('Conta não encontrada nesta loja.');
  if (conta.status !== 'ATIVO' && !l.estornoDe) throw new ConflictException('Esta conta está inativa. Escolha outra conta.');
  return (await c.query(
    `INSERT INTO lancamento_financeiro (grupo_id, empresa_id, conta_id, data, valor_centavos, origem, origem_id, plano_conta_id, descricao, estorno_de, motivo, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [a.grupoId, l.empresaId, l.contaId, l.data, l.valorCentavos, l.origem, l.origemId ?? null, l.planoContaId ?? null, l.descricao, l.estornoDe ?? null, l.motivo ?? null, a.usuarioId])).rows[0].id;
}

/** Estorna um lançamento com o lançamento contrário (data = hoje, nunca reescreve o passado). */
export async function estornarLancamento(c: PoolClient, a: Pick<Acesso, 'grupoId' | 'usuarioId'>, lancamentoId: string, data: string, motivo: string): Promise<string> {
  const l = (await c.query(
    `SELECT empresa_id AS "empresaId", conta_id AS "contaId", valor_centavos AS valor, origem, origem_id AS "origemId", plano_conta_id AS "planoContaId", descricao FROM lancamento_financeiro WHERE id = $1`, [lancamentoId])).rows[0];
  if (!l) throw new NotFoundException('Lançamento não encontrado.');
  return registrarLancamento(c, a, { empresaId: l.empresaId, contaId: l.contaId, data, valorCentavos: -l.valor, origem: l.origem, origemId: l.origemId, planoContaId: l.planoContaId, descricao: `Estorno: ${l.descricao}`, estornoDe: lancamentoId, motivo });
}

/** Saldo da conta até a data (inclusive): saldo inicial (se já começou) + lançamentos. */
export async function saldoDaConta(c: PoolClient, contaId: string, ate: string): Promise<number> {
  const r = (await c.query(
    `SELECT (CASE WHEN cf.data_saldo_inicial <= $2 THEN cf.saldo_inicial_centavos ELSE 0 END)
          + coalesce((SELECT sum(l.valor_centavos) FROM lancamento_financeiro l WHERE l.conta_id = cf.id AND l.data <= $2), 0) AS saldo
       FROM conta_financeira cf WHERE cf.id = $1`, [contaId, ate])).rows[0];
  if (!r) throw new NotFoundException('Conta não encontrada.');
  return Number(r.saldo);
}

export const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** Dia do fechamento já feito mais recente da conta, ou null. Lançamento com data até ele é recusado pelo banco. */
export async function ultimoDiaFechado(c: PoolClient, contaId: string): Promise<string | null> {
  return (await c.query(`SELECT max(data)::text AS d FROM fechamento_caixa WHERE conta_id = $1 AND status = 'FECHADO'`, [contaId])).rows[0]?.d ?? null;
}
export const periodoEstaFechado = async (c: PoolClient, empresaId: string, data: string): Promise<boolean> =>
  (await c.query('SELECT periodo_fechado($1, $2) AS f', [empresaId, data])).rows[0].f;
