import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { formatarBRL, type filtroCartaoSchema, type liquidarCartaoSchema, type liquidarLoteSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { estornarLancamento, hojeSP, registrarLancamento } from '../caixa/razao';

const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });

@Injectable()
export class CartaoService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  async listar(a: Acesso, f: z.output<typeof filtroCartaoSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const onde = ['q.empresa_id = $1']; const p: unknown[] = [empresaId];
      const add = (sql: string, v: unknown) => { p.push(v); onde.push(sql.replace('?', `$${p.length}`)); };
      if (f.situacao === 'previstas') onde.push(`q.status = 'PREVISTO'`);
      if (f.situacao === 'atrasadas') { p.push(hoje); onde.push(`q.status = 'PREVISTO' AND q.data_prevista < $${p.length}`); }
      if (f.situacao === 'liquidadas') onde.push(`q.status = 'LIQUIDADO'`);
      if (f.situacao === 'canceladas') onde.push(`q.status = 'CANCELADO'`);
      if (f.formaId) add('q.forma_pagamento_id = ?', f.formaId);
      if (f.de) add('q.data_prevista >= ?', f.de);
      if (f.ate) add('q.data_prevista <= ?', f.ate);
      const base = `FROM liquidacao_cartao q JOIN baixa_receber b ON b.id = q.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id JOIN laudo l ON l.id = t.laudo_id JOIN cliente cl ON cl.id = t.cliente_id
                    JOIN forma_pagamento fp ON fp.id = q.forma_pagamento_id LEFT JOIN conta_financeira cf ON cf.id = q.conta_id WHERE ${onde.join(' AND ')}`;
      const tot = (await c.query(`SELECT count(*)::int AS n, coalesce(sum(q.bruto_centavos), 0)::bigint AS bruto, coalesce(sum(q.taxa_centavos + q.antecipacao_centavos), 0)::bigint AS taxas, coalesce(sum(q.liquido_centavos), 0)::bigint AS liquido ${base}`, p)).rows[0];
      p.push(f.limite, f.pagina * f.limite);
      const itens = (await c.query(
        `SELECT q.id, l.numero_interno::int AS numero, l.placa, cl.nome AS cliente, fp.nome AS forma, q.data_venda::text AS "dataVenda", q.data_prevista::text AS "dataPrevista",
                q.bruto_centavos AS "brutoCentavos", q.taxa_bp AS "taxaBp", q.taxa_centavos AS "taxaCentavos", q.antecipacao_centavos AS "antecipacaoCentavos", q.liquido_centavos AS "liquidoCentavos",
                q.status, cf.nome AS conta, q.data_liquidacao::text AS "dataLiquidacao"
           ${base} ORDER BY q.data_prevista, q.criado_em LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
      const agenda = (await c.query(
        `SELECT data_prevista::text AS data, sum(liquido_centavos)::bigint AS "liquidoCentavos", count(*)::int AS vendas FROM liquidacao_cartao
          WHERE empresa_id = $1 AND status = 'PREVISTO' GROUP BY data_prevista ORDER BY data_prevista LIMIT 45`, [empresaId])).rows;
      return { itens: itens.map((i) => ({ ...i, atrasada: i.status === 'PREVISTO' && i.dataPrevista < hoje })), total: tot.n, brutoCentavos: tot.bruto, taxasCentavos: tot.taxas, liquidoCentavos: tot.liquido, agenda, hoje };
    });
  }

  private async liquidarUma(c: PoolClient, a: Acesso, id: string, d: { contaId: string; data?: string; liquidoRecebidoCentavos?: number; motivo?: string }) {
    const q = (await c.query(
      `SELECT q.id, q.empresa_id AS "empresaId", q.status, q.data_venda::text AS "dataVenda", q.bruto_centavos AS bruto, q.taxa_centavos AS taxa, q.antecipacao_centavos AS ant, q.liquido_centavos AS liquido,
              l.numero_interno::int AS numero, l.placa FROM liquidacao_cartao q JOIN baixa_receber b ON b.id = q.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id JOIN laudo l ON l.id = t.laudo_id WHERE q.id = $1 FOR UPDATE OF q`, [id])).rows[0];
    if (!q) throw new NotFoundException('Venda no cartão não encontrada.');
    exigir(a, 'receber.baixar', q.empresaId);
    if (q.status === 'LIQUIDADO') throw new ConflictException('A operadora já pagou esta venda.');
    if (q.status === 'CANCELADO') throw new ConflictException('Esta venda foi cancelada.');
    const hoje = hojeSP(); const data = d.data ?? hoje;
    if (data > hoje) throw erroCampo('data', 'A data do depósito não pode ser futura.');
    if (data < q.dataVenda) throw erroCampo('data', 'O depósito não pode ser antes da venda.');
    let taxa = Number(q.taxa); let liquido = Number(q.liquido);
    if (d.liquidoRecebidoCentavos !== undefined && d.liquidoRecebidoCentavos !== liquido) {
      if (d.liquidoRecebidoCentavos > liquido) throw erroCampo('liquidoRecebidoCentavos', `O depósito não pode ser maior que o previsto (${formatarBRL(liquido)}).`);
      if (!d.motivo) throw erroCampo('motivo', 'Explique a diferença entre o depósito e o valor previsto.');
      taxa += liquido - d.liquidoRecebidoCentavos; liquido = d.liquidoRecebidoCentavos; // a diferença vira taxa
    }
    const lanc = await registrarLancamento(c, a, { empresaId: q.empresaId, contaId: d.contaId, data, valorCentavos: liquido, origem: 'LIQUIDACAO_CARTAO', origemId: id, descricao: `Cartão: laudo nº ${q.numero} (${q.placa}), líquido de ${formatarBRL(Number(q.bruto))} bruto` });
    await c.query(`UPDATE liquidacao_cartao SET status = 'LIQUIDADO', conta_id = $2, data_liquidacao = $3, lancamento_id = $4, taxa_centavos = $5, liquidado_por = $6, liquidado_em = now() WHERE id = $1`, [id, d.contaId, data, lanc, taxa, a.usuarioId]);
    await auditar(c, a, { acao: 'cartao.liquidado', entidade: 'liquidacao_cartao', entidadeId: id, empresaId: q.empresaId, depois: { laudo: q.numero, brutoCentavos: Number(q.bruto), liquidoCentavos: liquido, taxaCentavos: taxa, data }, motivo: d.motivo });
    return { id, liquidoCentavos: liquido };
  }

  liquidar(a: Acesso, id: string, d: z.output<typeof liquidarCartaoSchema>) { return this.db.tenant(contextoDb(a), (c) => this.liquidarUma(c, a, id, d)); }

  async liquidarLote(a: Acesso, d: z.output<typeof liquidarLoteSchema>) {
    const resultados: { id: string; ok: boolean; liquidoCentavos?: number; erro?: string }[] = [];
    for (const id of d.ids) {
      try { const r = await this.db.tenant(contextoDb(a), (c) => this.liquidarUma(c, a, id, { contaId: d.contaId, data: d.data })); resultados.push({ ok: true, ...r }); }
      catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { mensagem?: string; message?: string } | string | undefined;
        if (!resp) throw e;
        resultados.push({ id, ok: false, erro: typeof resp === 'string' ? resp : resp.mensagem ?? resp.message ?? 'Não foi possível liquidar.' });
      }
    }
    return { liquidadas: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).length, resultados };
  }

  /** Desfaz uma liquidação lançada por engano: o dinheiro sai do caixa de novo e a venda volta a ser prevista. */
  async desfazer(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const q = (await c.query(`SELECT id, empresa_id AS "empresaId", status, lancamento_id AS "lancamentoId" FROM liquidacao_cartao WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!q) throw new NotFoundException('Venda no cartão não encontrada.');
      exigir(a, 'receber.estornar', q.empresaId);
      if (q.status !== 'LIQUIDADO') throw new ConflictException('Esta venda não está liquidada.');
      await estornarLancamento(c, a, q.lancamentoId, hojeSP(), motivo);
      await c.query(`UPDATE liquidacao_cartao SET status = 'PREVISTO', conta_id = NULL, data_liquidacao = NULL, lancamento_id = NULL, liquidado_por = NULL, liquidado_em = NULL WHERE id = $1`, [id]);
      await auditar(c, a, { acao: 'cartao.liquidacao_desfeita', entidade: 'liquidacao_cartao', entidadeId: id, empresaId: q.empresaId, motivo });
      return { ok: true };
    });
  }
}
