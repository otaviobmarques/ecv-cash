import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { calcularAtraso, type baixaSchema, type configFinanceiraSchema, type filtroReceberSchema, type loteBaixaSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { encargosDaBaixa, executarBaixa, executarEstornoBaixa, lerTituloParaBaixa } from './baixa';

type Filtro = z.output<typeof filtroReceberSchema>;

@Injectable()
export class ReceberService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  async listar(a: Acesso, f: Filtro) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const onde = ['t.empresa_id = $1']; const p: unknown[] = [empresaId];
      const add = (sql: string, v: unknown) => { p.push(v); onde.push(sql.replace('?', `$${p.length}`)); };
      if (f.situacao === 'abertos') onde.push(`t.status IN ('ABERTO','PARCIAL')`);
      if (f.situacao === 'vencidos') { p.push(hoje); onde.push(`t.status IN ('ABERTO','PARCIAL') AND t.vencimento < $${p.length}`); }
      if (f.situacao === 'quitados') onde.push(`t.status = 'QUITADO'`);
      if (f.situacao === 'cancelados') onde.push(`t.status = 'CANCELADO'`);
      if (f.clienteId) add('t.cliente_id = ?', f.clienteId);
      if (f.formaPagamentoId) add('t.forma_pagamento_id = ?', f.formaPagamentoId);
      if (f.placa) add(`l.placa LIKE ? || '%'`, f.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (f.vencDe) add('t.vencimento >= ?', f.vencDe);
      if (f.vencAte) add('t.vencimento <= ?', f.vencAte);
      if (f.semFatura) onde.push('t.fatura_id IS NULL');
      const base = `FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id JOIN cliente cl ON cl.id = t.cliente_id JOIN servico s ON s.id = l.servico_id JOIN forma_pagamento fp ON fp.id = t.forma_pagamento_id WHERE ${onde.join(' AND ')}`;
      const total = (await c.query(`SELECT count(*)::int AS n, coalesce(sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE t.status IN ('ABERTO','PARCIAL')), 0)::bigint AS saldo ${base}`, p)).rows[0];
      p.push(f.limite, f.pagina * f.limite);
      const rows = (await c.query(
        `SELECT t.id, t.laudo_id AS "laudoId", l.numero_interno::int AS numero, l.placa, l.data_laudo::text AS "dataLaudo", t.cliente_id AS "clienteId", cl.nome AS cliente, s.nome AS servico, fp.nome AS forma,
                t.valor_centavos AS "valorCentavos", t.pago_centavos AS "pagoCentavos", t.vencimento::text AS vencimento, t.status, t.fatura_id AS "faturaId",
                cl.multa_bp AS "multaBp", cl.juros_mes_bp AS "jurosMesBp"
           ${base} ORDER BY t.vencimento, l.numero_interno LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
      const itens = rows.map(({ multaBp, jurosMesBp, ...r }) => {
        const saldo = r.valorCentavos - r.pagoCentavos;
        const aberto = r.status === 'ABERTO' || r.status === 'PARCIAL';
        const at = aberto ? calcularAtraso(saldo, r.vencimento, hoje, { multaBp, jurosMesBp }) : null;
        return { ...r, saldoCentavos: saldo, vencido: aberto && r.vencimento < hoje, diasAtraso: at?.diasAtraso ?? 0, encargosCentavos: at ? at.multa + at.juros : 0 };
      });
      return { itens, total: total.n, saldoAbertoCentavos: total.saldo, hoje };
    });
  }

  async resumo(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const r = (await c.query(
        `SELECT coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('ABERTO','PARCIAL')), 0)::bigint AS "aReceberCentavos",
                coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('ABERTO','PARCIAL') AND vencimento < $2), 0)::bigint AS "vencidoCentavos",
                coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('ABERTO','PARCIAL') AND vencimento BETWEEN $2 AND $2::date + 7), 0)::bigint AS "venceEm7DiasCentavos",
                count(*) FILTER (WHERE status IN ('ABERTO','PARCIAL'))::int AS "titulosAbertos"
           FROM titulo_receber WHERE empresa_id = $1`, [empresaId, hoje])).rows[0];
      const mes = (await c.query(
        `SELECT coalesce(sum(recebido_centavos), 0)::bigint AS v FROM baixa_receber WHERE empresa_id = $1 AND data >= date_trunc('month', $2::date)`, [empresaId, hoje])).rows[0].v;
      return { ...r, recebidoNoMesCentavos: mes };
    });
  }

  async detalhe(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await lerTituloParaBaixa(c, id);
      exigir(a, 'receber.ver', t.empresaId);
      const baixas = (await c.query(
        `SELECT b.id, b.data::text AS data, b.principal_centavos AS "principalCentavos", b.multa_centavos AS "multaCentavos", b.juros_centavos AS "jurosCentavos", b.perdao_centavos AS "perdaoCentavos",
                b.recebido_centavos AS "recebidoCentavos", fp.nome AS forma, cf.nome AS conta, b.estorno_de AS "estornoDe", b.motivo, u.nome AS "criadoPor", b.criado_em AS "criadoEm",
                EXISTS (SELECT 1 FROM baixa_receber e WHERE e.estorno_de = b.id) AS estornada
           FROM baixa_receber b JOIN forma_pagamento fp ON fp.id = b.forma_pagamento_id LEFT JOIN conta_financeira cf ON cf.id = b.conta_id LEFT JOIN usuario u ON u.id = b.criado_por
          WHERE b.titulo_id = $1 ORDER BY b.criado_em`, [id])).rows;
      const extra = (await c.query(`SELECT t.fatura_id AS "faturaId", t.numero_nf AS "numeroNf", t.motivo_cancelamento AS "motivoCancelamento", fp.nome AS forma, fp.tipo AS "formaTipo" FROM titulo_receber t JOIN forma_pagamento fp ON fp.id = t.forma_pagamento_id WHERE t.id = $1`, [id])).rows[0];
      return { ...t, ...extra, saldoCentavos: t.valorCentavos - t.pagoCentavos, baixas };
    });
  }

  async simular(a: Acesso, id: string, data: string | undefined, principal: number | undefined) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await lerTituloParaBaixa(c, id);
      exigir(a, 'receber.ver', t.empresaId);
      const saldo = t.valorCentavos - t.pagoCentavos;
      const p = Math.min(principal ?? saldo, saldo);
      const d = data ?? hojeSP();
      const e = encargosDaBaixa(t, p, d);
      return { principalCentavos: p, saldoCentavos: saldo, data: d, diasAtraso: e.diasAtraso, multaCentavos: e.multa, jurosCentavos: e.juros, totalCentavos: p + e.multa + e.juros };
    });
  }

  baixar(a: Acesso, id: string, d: z.output<typeof baixaSchema>) {
    return this.db.tenant(contextoDb(a), (c) => executarBaixa(c, a, { tituloId: id, ...d }));
  }

  /** Cada título vale por si: os bons são baixados, os com problema voltam com o motivo. */
  async baixarLote(a: Acesso, d: z.output<typeof loteBaixaSchema>) {
    const lote = crypto.randomUUID();
    const resultados: { tituloId: string; ok: boolean; erro?: string; baixa?: unknown }[] = [];
    for (const it of d.itens) {
      try {
        const baixa = await this.db.tenant(contextoDb(a), (c) => executarBaixa(c, a, { tituloId: it.tituloId, principalCentavos: it.principalCentavos, data: d.data, contaId: d.contaId, formaPagamentoId: d.formaPagamentoId, perdoarEncargos: d.perdoarEncargos, motivo: d.motivo, loteId: lote }));
        resultados.push({ tituloId: it.tituloId, ok: true, baixa });
      } catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { mensagem?: string; message?: string } | string | undefined;
        if (!resp) throw e;
        resultados.push({ tituloId: it.tituloId, ok: false, erro: typeof resp === 'string' ? resp : resp.mensagem ?? resp.message ?? 'Não foi possível baixar este título.' });
      }
    }
    return { lote, baixados: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).length, resultados };
  }

  estornar(a: Acesso, baixaId: string, motivo: string) {
    return this.db.tenant(contextoDb(a), (c) => executarEstornoBaixa(c, a, baixaId, motivo));
  }

  // ---- configuração financeira da loja ----
  async config(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query(
        `SELECT perdao_limite_centavos AS "perdaoLimiteCentavos", aprovacao_pagar_obrigatoria AS "aprovacaoPagarObrigatoria", financeiro_aprova_pagar AS "financeiroAprovaPagar", financeiro_ve_dre AS "financeiroVeDre"
           FROM empresa_config WHERE empresa_id = $1`, [empresaId])).rows[0];
      return r ?? { perdaoLimiteCentavos: 5000, aprovacaoPagarObrigatoria: true, financeiroAprovaPagar: false, financeiroVeDre: false };
    });
  }

  async salvarConfig(a: Acesso, d: z.output<typeof configFinanceiraSchema>) {
    const empresaId = this.empresaAtiva(a);
    if (!a.rede) throw new ForbiddenException('Só o Administrativo altera as regras financeiras da loja.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = await this.config(a);
      const novo = { ...antes, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) };
      await c.query(
        `INSERT INTO empresa_config (empresa_id, grupo_id, perdao_limite_centavos, aprovacao_pagar_obrigatoria, financeiro_aprova_pagar, financeiro_ve_dre) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (empresa_id) DO UPDATE SET perdao_limite_centavos = EXCLUDED.perdao_limite_centavos, aprovacao_pagar_obrigatoria = EXCLUDED.aprovacao_pagar_obrigatoria,
           financeiro_aprova_pagar = EXCLUDED.financeiro_aprova_pagar, financeiro_ve_dre = EXCLUDED.financeiro_ve_dre, atualizado_em = now()`,
        [empresaId, a.grupoId, novo.perdaoLimiteCentavos, novo.aprovacaoPagarObrigatoria, novo.financeiroAprovaPagar, novo.financeiroVeDre]);
      await auditar(c, a, { acao: 'config_financeira.alterada', entidade: 'empresa_config', entidadeId: empresaId, empresaId, antes, depois: novo });
      return novo;
    });
  }
}
void BadRequestException; void ConflictException; void NotFoundException;
