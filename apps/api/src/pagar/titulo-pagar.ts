import type { PoolClient } from 'pg';
import type { Acesso } from '../common/acesso';

export async function configPagar(c: PoolClient, empresaId: string) {
  const r = (await c.query('SELECT aprovacao_pagar_obrigatoria AS obrig, financeiro_aprova_pagar AS fin FROM empresa_config WHERE empresa_id = $1', [empresaId])).rows[0];
  return { aprovacaoObrigatoria: r?.obrig ?? true, financeiroAprova: r?.fin ?? false };
}

export interface NovoTituloPagar {
  fornecedorId?: string | null; beneficiario?: string | null; descricao: string; planoContaId?: string | null; competencia?: string | null; vencimento: string; valorCentavos: number;
  numeroDocumento?: string | null; observacao?: string | null; anexoId?: string | null; rascunho?: boolean;
  origem?: string; origemId?: string | null; recorrenciaId?: string | null; rateioId?: string | null; status?: string; criadoPor?: string | null;
}

/** Cria a conta a pagar já no estado certo: rascunho, aguardando aprovação ou aprovada (quando a loja não exige aprovação). */
export async function inserirTituloPagar(c: PoolClient, a: Pick<Acesso, 'grupoId' | 'usuarioId'>, empresaId: string, d: NovoTituloPagar): Promise<string> {
  const cfg = await configPagar(c, empresaId);
  const status = d.status ?? (d.rascunho ? 'RASCUNHO' : cfg.aprovacaoObrigatoria ? 'PENDENTE' : 'APROVADO');
  const r = await c.query(
    `INSERT INTO titulo_pagar (grupo_id, empresa_id, fornecedor_id, beneficiario, descricao, plano_conta_id, competencia, vencimento, valor_centavos, status, origem, origem_id, recorrencia_id, rateio_id, numero_documento, observacao, anexo_id, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [a.grupoId, empresaId, d.fornecedorId ?? null, d.beneficiario ?? null, d.descricao, d.planoContaId ?? null, d.competencia ? `${d.competencia}-01` : `${d.vencimento.slice(0, 7)}-01`, d.vencimento, d.valorCentavos, status,
     d.origem ?? 'MANUAL', d.origemId ?? null, d.recorrenciaId ?? null, d.rateioId ?? null, d.numeroDocumento ?? null, d.observacao ?? null, d.anexoId ?? null, d.criadoPor === undefined ? a.usuarioId : d.criadoPor]);
  return r.rows[0].id as string;
}
