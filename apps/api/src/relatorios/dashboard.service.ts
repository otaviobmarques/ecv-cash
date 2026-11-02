import { Injectable } from '@nestjs/common';
import { temPermissao } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, perfilEm } from '../common/acesso';
import { hojeSP } from '../caixa/razao';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  /** Painel de início por perfil: o Vistoriador vê só os próprios laudos; Gerente, Financeiro e Administrativo veem o dinheiro da loja ativa; o Administrativo também vê a rede. */
  async painel(a: Acesso) {
    const empresaId = a.empresaAtivaId;
    const perfil = perfilEm(a, empresaId);
    if (!empresaId || !perfil) return { perfil: null };
    const hoje = hojeSP(); const mes = `${hoje.slice(0, 8)}01`;
    return this.db.tenant(contextoDb(a), async (c) => {
      if (perfil === 'VISTORIADOR') {
        const meu = (await c.query(`SELECT id FROM vistoriador WHERE usuario_id = $1 AND status = 'ATIVO'`, [a.usuarioId])).rows[0]?.id ?? null;
        const r = (await c.query(
          `SELECT count(*) FILTER (WHERE data_laudo = $2)::int AS "laudosHoje", count(*) FILTER (WHERE data_laudo >= $3)::int AS "laudosMes"
             FROM laudo WHERE empresa_id = $1 AND status = 'ATIVO' AND vistoriador_id = $4`, [empresaId, hoje, mes, meu])).rows[0];
        const ultimos = (await c.query(`SELECT l.id, l.numero_interno::int AS numero, l.placa, s.nome AS servico, l.data_laudo::text AS "dataLaudo" FROM laudo l JOIN servico s ON s.id = l.servico_id WHERE l.empresa_id = $1 AND l.vistoriador_id = $2 AND l.status = 'ATIVO' ORDER BY l.numero_interno DESC LIMIT 5`, [empresaId, meu])).rows;
        return { perfil, hoje, vinculado: !!meu, ...r, ultimos };
      }
      const laudos = (await c.query(
        `SELECT count(*) FILTER (WHERE data_laudo = $2)::int AS "laudosHoje", coalesce(sum(valor_cobrado_centavos) FILTER (WHERE data_laudo = $2), 0)::bigint AS "valorHoje",
                count(*) FILTER (WHERE data_laudo >= $3)::int AS "laudosMes", coalesce(sum(valor_cobrado_centavos) FILTER (WHERE data_laudo >= $3), 0)::bigint AS "valorMes",
                count(*) FILTER (WHERE preco_manual AND revisado_em IS NULL)::int AS "manuaisARevisar", count(*) FILTER (WHERE cancelamento_pedido_em IS NOT NULL)::int AS "pedidosCancelamento"
           FROM laudo WHERE empresa_id = $1 AND status = 'ATIVO'`, [empresaId, hoje, mes])).rows[0];
      const receber = (await c.query(
        `SELECT coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('ABERTO','PARCIAL')), 0)::bigint AS "aReceberCentavos",
                coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('ABERTO','PARCIAL') AND vencimento < $2), 0)::bigint AS "vencidoCentavos"
           FROM titulo_receber WHERE empresa_id = $1`, [empresaId, hoje])).rows[0];
      const pagar = (await c.query(
        `SELECT coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('APROVADO','PARCIAL')), 0)::bigint AS "aPagarCentavos",
                coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('APROVADO','PARCIAL') AND vencimento < $2), 0)::bigint AS "pagarVencidoCentavos",
                count(*) FILTER (WHERE status = 'PENDENTE')::int AS "pendentesAprovacao"
           FROM titulo_pagar WHERE empresa_id = $1`, [empresaId, hoje])).rows[0];
      const caixa = (await c.query(
        `SELECT coalesce(sum(CASE WHEN cf.data_saldo_inicial <= $2 THEN cf.saldo_inicial_centavos ELSE 0 END), 0)::bigint
                + coalesce((SELECT sum(l.valor_centavos) FROM lancamento_financeiro l WHERE l.empresa_id = $1 AND l.data <= $2), 0)::bigint AS saldo
           FROM conta_financeira cf WHERE cf.empresa_id = $1 AND cf.status = 'ATIVO'`, [empresaId, hoje])).rows[0];
      const fluxoMes = (await c.query(
        `SELECT coalesce(sum(valor_centavos) FILTER (WHERE valor_centavos > 0 AND origem <> 'TRANSFERENCIA'), 0)::bigint AS entradas,
                coalesce(-sum(valor_centavos) FILTER (WHERE valor_centavos < 0 AND origem <> 'TRANSFERENCIA'), 0)::bigint AS saidas
           FROM lancamento_financeiro WHERE empresa_id = $1 AND data >= $2`, [empresaId, mes])).rows[0];
      const serie = (await c.query(
        `SELECT d::date::text AS dia, coalesce(sum(l.valor_cobrado_centavos), 0)::bigint AS valor, count(l.id)::int AS laudos
           FROM generate_series($2::date - 29, $2::date, interval '1 day') d
           LEFT JOIN laudo l ON l.data_laudo = d::date AND l.empresa_id = $1 AND l.status = 'ATIVO' GROUP BY d ORDER BY d`, [empresaId, hoje])).rows;
      const base = { perfil, hoje, ...laudos, ...receber, ...pagar, saldoCaixaCentavos: caixa.saldo, entradasMesCentavos: fluxoMes.entradas, saidasMesCentavos: fluxoMes.saidas, serie };
      const dados: Record<string, unknown> = perfil === 'FINANCEIRO' ? { ...base, manuaisARevisar: undefined, pedidosCancelamento: undefined } : base;
      if (a.rede) {
        dados.lojas = (await c.query(
          `SELECT e.id, e.nome_fantasia AS nome,
                  (SELECT count(*)::int FROM laudo l WHERE l.empresa_id = e.id AND l.status = 'ATIVO' AND l.data_laudo >= $1) AS "laudosMes",
                  (SELECT coalesce(sum(l.valor_cobrado_centavos), 0)::bigint FROM laudo l WHERE l.empresa_id = e.id AND l.status = 'ATIVO' AND l.data_laudo >= $1) AS "valorMes",
                  (SELECT coalesce(sum(t.valor_centavos - t.pago_centavos), 0)::bigint FROM titulo_receber t WHERE t.empresa_id = e.id AND t.status IN ('ABERTO','PARCIAL')) AS "aReceberCentavos",
                  (SELECT coalesce(sum(t.valor_centavos - t.pago_centavos), 0)::bigint FROM titulo_receber t WHERE t.empresa_id = e.id AND t.status IN ('ABERTO','PARCIAL') AND t.vencimento < $2) AS "vencidoCentavos",
                  (SELECT coalesce(sum(t.valor_centavos - t.pago_centavos), 0)::bigint FROM titulo_pagar t WHERE t.empresa_id = e.id AND t.status IN ('APROVADO','PARCIAL')) AS "aPagarCentavos"
             FROM empresa e WHERE e.status = 'ATIVO' ORDER BY e.nome_fantasia`, [mes, hoje])).rows;
      }
      void temPermissao;
      return dados;
    });
  }
}
