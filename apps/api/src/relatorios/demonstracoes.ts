import type { PoolClient } from 'pg';
import type { ColunaRelatorio } from '@ecv/shared';
import { impostosDoPeriodo } from '../repasses/impostos';
import type { Relatorio } from './relatorios.service';

type Linha = Record<string, unknown>;
const col = (chave: string, rotulo: string, tipo: ColunaRelatorio['tipo'] = 'dinheiro'): ColunaRelatorio => ({ chave, rotulo, tipo });
const mesesEntre = (de: string, ate: string): string[] => {
  const out: string[] = []; let a = +de.slice(0, 4), m = +de.slice(5, 7);
  while (`${a}-${String(m).padStart(2, '0')}` <= ate.slice(0, 7)) { out.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++; } }
  return out;
};
const fimDoMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10);
const rotuloMes = (mes: string) => `${mes.slice(5)}/${mes.slice(0, 4)}`;
const chaveMes = (mes: string) => `m${mes.replace('-', '_')}`;

/** Monta a tabela do DRE: uma coluna por mês e o total. Cada linha guarda seus valores por mês; as linhas de resultado somam as de cima. */
class Tabela {
  readonly linhas: Linha[] = [];
  constructor(private readonly meses: string[]) {}
  private novo(rotulo: string, nivel: 0 | 1, valores: Record<string, number>, extra: Linha = {}): Linha {
    const l: Linha = { linha: rotulo, _nivel: nivel, ...extra };
    let total = 0;
    for (const m of this.meses) { const v = valores[m] ?? 0; l[chaveMes(m)] = v; total += v; }
    l.total = total; this.linhas.push(l); return l;
  }
  /** Linha com sinal (receita positiva, despesa negativa) e as subdivisões abaixo dela. */
  grupo(rotulo: string, sinal: 1 | -1, filhos: { rotulo: string; valores: Record<string, number> }[]): Record<string, number> {
    const soma: Record<string, number> = {};
    for (const f of filhos) for (const m of this.meses) soma[m] = (soma[m] ?? 0) + (f.valores[m] ?? 0) * sinal;
    this.novo(rotulo, 0, soma, { _negrito: false });
    if (filhos.length > 1 || (filhos.length === 1 && filhos[0]!.rotulo !== rotulo)) for (const f of filhos) this.novo(f.rotulo, 1, Object.fromEntries(this.meses.map((m) => [m, (f.valores[m] ?? 0) * sinal])), { _sub: true });
    return soma;
  }
  resultado(rotulo: string, ...parcelas: Record<string, number>[]): Record<string, number> {
    const soma: Record<string, number> = {};
    for (const p of parcelas) for (const m of this.meses) soma[m] = (soma[m] ?? 0) + (p[m] ?? 0);
    this.novo(rotulo, 0, soma, { _negrito: true });
    return soma;
  }
}

const porMes = (rows: { mes: string; v: string | number; rotulo?: string }[], rotuloPadrao?: string) => {
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) { const k = r.rotulo ?? rotuloPadrao ?? ''; const o = m.get(k) ?? {}; o[r.mes] = (o[r.mes] ?? 0) + Number(r.v); m.set(k, o); }
  return m;
};
const filhos = (m: Map<string, Record<string, number>>) => [...m.entries()].map(([rotulo, valores]) => ({ rotulo, valores }));

/** `empresaIds` com várias lojas = visão consolidada; com `elimina`, o que é só movimento entre empresas do grupo sai do resultado. */
export async function gerarDre(c: PoolClient, empresaIds: string[], de: string, ate: string, regime: 'competencia' | 'caixa', elimina = false): Promise<Relatorio> {
  const empresaId = empresaIds;
  const clienteInterno = (alias: string) => (elimina ? `AND NOT EXISTS (SELECT 1 FROM cliente zc WHERE zc.id = ${alias}.cliente_id AND zc.empresa_vinculada_id IS NOT NULL)` : '');
  const fornecedorInterno = (alias: string) => (elimina ? `AND NOT EXISTS (SELECT 1 FROM fornecedor zf WHERE zf.id = ${alias}.fornecedor_id AND zf.empresa_vinculada_id IS NOT NULL)` : '');
  const caixaInterno = (alias: string) => (elimina ? `AND NOT lancamento_intercompany(${alias}.id)` : '');
  const meses = mesesEntre(de, ate);
  const t = new Tabela(meses);
  const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, [empresaId, de, ate, ...p])).rows as { mes: string; v: string; rotulo?: string }[];
  const impostosPorMes = async (): Promise<Map<string, Record<string, number>>> => {
    const m = new Map<string, Record<string, number>>();
    for (const mes of meses) {
      const ini = mes === de.slice(0, 7) ? de : `${mes}-01`; const fim = mes === ate.slice(0, 7) ? ate : fimDoMes(mes);
      for (const i of await impostosDoPeriodo(c, empresaIds, ini, fim, regime === 'competencia' ? 'COMPETENCIA' : 'CAIXA')) { const o = m.get(i.rotulo) ?? {}; o[mes] = (o[mes] ?? 0) + i.totalCentavos; m.set(i.rotulo, o); }
    }
    return m;
  };

  if (regime === 'competencia') {
    const receita = t.grupo('Receita bruta de serviços', 1, filhos(porMes(await q(
      `SELECT to_char(l.data_laudo, 'YYYY-MM') AS mes, sum(l.valor_cobrado_centavos) AS v, coalesce(pc.codigo || ' ' || pc.nome, 'Sem classificação') AS rotulo
         FROM laudo l JOIN servico s ON s.id = l.servico_id LEFT JOIN plano_conta pc ON pc.id = s.conta_receita_id
        WHERE l.empresa_id = ANY($1::uuid[]) AND l.status = 'ATIVO' AND l.data_laudo BETWEEN $2 AND $3 ${clienteInterno('l')} GROUP BY 1, 3`))));
    const impostos = t.grupo('(−) Impostos sobre o faturamento', -1, filhos(await impostosPorMes()));
    const liquida = t.resultado('Receita líquida', receita, impostos);
    const custos = t.grupo('(−) Custos diretos dos laudos', -1, filhos(porMes(await q(
      `SELECT to_char(l.data_laudo, 'YYYY-MM') AS mes, sum(lc.valor_centavos) AS v, lc.descricao AS rotulo FROM laudo_custo lc JOIN laudo l ON l.id = lc.laudo_id
        WHERE l.empresa_id = ANY($1::uuid[]) AND l.status = 'ATIVO' AND lc.ativo AND l.data_laudo BETWEEN $2 AND $3 GROUP BY 1, 3`))));
    const bruto = t.resultado('Lucro bruto', liquida, custos);
    const comissoes = t.grupo('(−) Comissões dos vistoriadores', -1, filhos(porMes(await q(
      `SELECT to_char(l.data_laudo, 'YYYY-MM') AS mes, sum(lc.valor_centavos) AS v FROM laudo_comissao lc JOIN laudo l ON l.id = lc.laudo_id
        WHERE l.empresa_id = ANY($1::uuid[]) AND l.status = 'ATIVO' AND lc.ativo AND l.data_laudo BETWEEN $2 AND $3 GROUP BY 1`), 'Comissões')));
    const royalties = t.grupo('(−) Royalties e taxas da franquia', -1, filhos(porMes(await q(
      `SELECT to_char(competencia, 'YYYY-MM') AS mes, sum(valor_centavos) AS v FROM titulo_pagar t WHERE t.empresa_id = ANY($1::uuid[]) AND t.origem = 'ROYALTY' AND t.status NOT IN ('CANCELADO','RASCUNHO') AND t.competencia BETWEEN $2 AND $3 ${fornecedorInterno('t')} GROUP BY 1`), 'Royalties')));
    const cartao = t.grupo('(−) Taxas de cartão', -1, filhos(porMes(await q(
      `SELECT to_char(data_venda, 'YYYY-MM') AS mes, sum(taxa_centavos + antecipacao_centavos) AS v FROM liquidacao_cartao WHERE empresa_id = ANY($1::uuid[]) AND status <> 'CANCELADO' AND data_venda BETWEEN $2 AND $3 GROUP BY 1`), 'Taxas de cartão')));
    const despesas = t.grupo('(−) Despesas operacionais', -1, filhos(porMes(await q(
      `SELECT to_char(t.competencia, 'YYYY-MM') AS mes, sum(t.valor_centavos) AS v, coalesce(pc.codigo || ' ' || pc.nome, 'Sem classificação') AS rotulo
         FROM titulo_pagar t LEFT JOIN plano_conta pc ON pc.id = t.plano_conta_id
        WHERE t.empresa_id = ANY($1::uuid[]) AND t.origem NOT IN ('CUSTO_LAUDO','COMISSAO','ROYALTY') AND t.status NOT IN ('CANCELADO','RASCUNHO') AND t.competencia BETWEEN $2 AND $3 ${fornecedorInterno('t')} GROUP BY 1, 3`))));
    const operacional = t.resultado('Resultado operacional', bruto, comissoes, royalties, cartao, despesas);
    const recFin = t.grupo('(+) Multas e juros recebidos', 1, filhos(porMes(await q(
      `SELECT to_char(data, 'YYYY-MM') AS mes, sum(multa_centavos + juros_centavos - perdao_centavos) AS v FROM baixa_receber WHERE empresa_id = ANY($1::uuid[]) AND data BETWEEN $2 AND $3 GROUP BY 1`), 'Multas e juros recebidos')));
    const despFin = t.grupo('(−) Juros, multas e descontos em pagamentos', -1, filhos(porMes(await q(
      `SELECT to_char(data, 'YYYY-MM') AS mes, sum(juros_centavos + multa_centavos - desconto_centavos) AS v FROM pagamento_pagar WHERE empresa_id = ANY($1::uuid[]) AND data BETWEEN $2 AND $3 GROUP BY 1`), 'Juros, multas e descontos')));
    t.resultado('Resultado do período', operacional, recFin, despFin);
    return { id: 'dre', titulo: 'DRE por competência', de, ate, colunas: colunasDre(meses), linhas: t.linhas, totais: null };
  }

  // por caixa: só o que entrou e saiu de verdade
  const recebido = t.grupo('Receitas recebidas', 1, [
    ...filhos(porMes(await q(`SELECT to_char(data, 'YYYY-MM') AS mes, sum(l.valor_centavos) AS v FROM lancamento_financeiro l WHERE l.empresa_id = ANY($1::uuid[]) AND l.origem = 'BAIXA_RECEBER' AND l.data BETWEEN $2 AND $3 ${caixaInterno('l')} GROUP BY 1`), 'Recebimentos em conta (dinheiro, PIX, transferência)')),
    ...filhos(porMes(await q(`SELECT to_char(data_liquidacao, 'YYYY-MM') AS mes, sum(bruto_centavos) AS v FROM liquidacao_cartao WHERE empresa_id = ANY($1::uuid[]) AND status = 'LIQUIDADO' AND data_liquidacao BETWEEN $2 AND $3 ${elimina ? 'AND NOT lancamento_intercompany(lancamento_id)' : ''} GROUP BY 1`), 'Cartões pagos pela operadora (valor bruto)')),
    ...filhos(porMes(await q(`SELECT to_char(l.data, 'YYYY-MM') AS mes, sum(l.valor_centavos) AS v FROM lancamento_financeiro l WHERE l.empresa_id = ANY($1::uuid[]) AND l.origem = 'CHEQUE' AND l.data BETWEEN $2 AND $3 ${caixaInterno('l')} GROUP BY 1`), 'Cheques compensados')),
  ]);
  const impostos = t.grupo('(−) Impostos sobre o que foi recebido', -1, filhos(await impostosPorMes()));
  const taxas = t.grupo('(−) Taxas de cartão', -1, filhos(porMes(await q(
    `SELECT to_char(data_liquidacao, 'YYYY-MM') AS mes, sum(taxa_centavos + antecipacao_centavos) AS v FROM liquidacao_cartao WHERE empresa_id = ANY($1::uuid[]) AND status = 'LIQUIDADO' AND data_liquidacao BETWEEN $2 AND $3 GROUP BY 1`), 'Taxas de cartão')));
  const pagos = async (origens: string[], rotuloPadrao?: string, plano = false) => porMes(await q(
    `SELECT to_char(p.data, 'YYYY-MM') AS mes, sum(p.pago_total_centavos) AS v ${plano ? `, coalesce(pc.codigo || ' ' || pc.nome, 'Sem classificação') AS rotulo` : ''}
       FROM pagamento_pagar p JOIN titulo_pagar t ON t.id = p.titulo_id ${plano ? 'LEFT JOIN plano_conta pc ON pc.id = t.plano_conta_id' : ''}
      WHERE p.empresa_id = ANY($1::uuid[]) AND p.data BETWEEN $2 AND $3 AND t.origem::text = ANY($4::text[]) ${fornecedorInterno('t')} GROUP BY 1 ${plano ? ', 3' : ''}`, [origens]), rotuloPadrao);
  const custos = t.grupo('(−) Custos de laudos pagos', -1, filhos(await pagos(['CUSTO_LAUDO'], 'Custos de laudos')));
  const comissoes = t.grupo('(−) Comissões pagas', -1, filhos(await pagos(['COMISSAO'], 'Comissões')));
  const royalties = t.grupo('(−) Royalties e taxas da franquia pagos', -1, filhos(await pagos(['ROYALTY'], 'Royalties')));
  const despesas = t.grupo('(−) Despesas pagas', -1, filhos(await pagos(['MANUAL', 'RECORRENCIA', 'RATEIO'], undefined, true)));
  t.resultado('Resultado de caixa do período', recebido, impostos, taxas, custos, comissoes, royalties, despesas);
  return { id: 'dre', titulo: 'DRE por caixa', de, ate, colunas: colunasDre(meses), linhas: t.linhas, totais: null };
}

const colunasDre = (meses: string[]): ColunaRelatorio[] => [col('linha', 'Linha', 'texto'), ...meses.map((m) => col(chaveMes(m), rotuloMes(m))), col('total', 'Total')];

// ---------- fluxo de caixa ----------
export async function gerarFluxo(c: PoolClient, empresaIds: string[], de: string, ate: string, modo: 'realizado' | 'projetado', hoje: string, dias: number, elimina = false): Promise<Relatorio> {
  const empresaId = empresaIds;
  const saldoAte = async (data: string) => Number((await c.query(
    `SELECT coalesce(sum(CASE WHEN data_saldo_inicial <= $2 THEN saldo_inicial_centavos ELSE 0 END), 0)
          + coalesce((SELECT sum(l.valor_centavos) FROM lancamento_financeiro l WHERE l.empresa_id = ANY($1::uuid[]) AND l.data <= $2), 0) AS s FROM conta_financeira WHERE empresa_id = ANY($1::uuid[]) AND status = 'ATIVO'`, [empresaId, data])).rows[0].s);

  if (modo === 'realizado') {
    const porMesAgrupado = Date.parse(ate) - Date.parse(de) > 62 * 86_400_000;
    const naoInterno = elimina ? 'AND NOT lancamento_intercompany(l.id)' : '';
    const internoSql = elimina ? 'lancamento_intercompany(l.id)' : 'false';
    const trunc = porMesAgrupado ? `to_char(l.data, 'YYYY-MM')` : `l.data::text`;
    const rows = (await c.query(
      `SELECT ${trunc} AS periodo,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem = 'BAIXA_RECEBER' ${naoInterno}), 0)::bigint AS recebimentos,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem = 'LIQUIDACAO_CARTAO' ${naoInterno}), 0)::bigint AS cartao,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem = 'CHEQUE' ${naoInterno}), 0)::bigint AS cheques,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem = 'AJUSTE' AND l.valor_centavos > 0 ${naoInterno}), 0)::bigint AS outras_entradas,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem = 'PAGAMENTO_PAGAR' ${naoInterno}), 0)::bigint AS pagamentos,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem = 'AJUSTE' AND l.valor_centavos < 0 ${naoInterno}), 0)::bigint AS outras_saidas,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem <> 'TRANSFERENCIA' AND ${internoSql}), 0)::bigint AS internas,
              coalesce(sum(l.valor_centavos) FILTER (WHERE l.origem <> 'TRANSFERENCIA'), 0)::bigint AS saldo_periodo
         FROM lancamento_financeiro l WHERE l.empresa_id = ANY($1::uuid[]) AND l.data BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`, [empresaId, de, ate])).rows as Linha[];
    let acum = await saldoAte(new Date(Date.parse(de) - 86_400_000).toISOString().slice(0, 10));
    const linhas: Linha[] = [{ periodo: 'Saldo inicial', saldoFinal: acum, _negrito: true }];
    // o saldo acumulado inclui as transferências entre contas (que não mudam o total da loja, mas mudam entre lojas)
    const transf = new Map<string, number>((await c.query(`SELECT ${trunc} AS periodo, sum(l.valor_centavos)::bigint AS v FROM lancamento_financeiro l WHERE l.empresa_id = ANY($1::uuid[]) AND l.origem = 'TRANSFERENCIA' AND l.data BETWEEN $2 AND $3 GROUP BY 1`, [empresaId, de, ate])).rows.map((r) => [r.periodo as string, Number(r.v)]));
    for (const r of rows) {
      acum += Number(r.saldo_periodo) + (transf.get(r.periodo as string) ?? 0);
      linhas.push({ ...r, periodo: porMesAgrupado ? rotuloMes(r.periodo as string) : r.periodo, _data: !porMesAgrupado, saldoFinal: acum });
    }
    linhas.push({ periodo: 'Saldo final', saldoFinal: acum, _negrito: true });
    const soma = (k: string) => rows.reduce((s, r) => s + Number(r[k]), 0);
    return { id: 'fluxo-caixa', titulo: 'Fluxo de caixa realizado', de, ate, linhas,
      colunas: [col('periodo', porMesAgrupado ? 'Mês' : 'Data', porMesAgrupado ? 'texto' : 'data'), col('recebimentos', 'Recebimentos'), col('cartao', 'Cartões'), col('cheques', 'Cheques'), col('outras_entradas', 'Outras entradas'), col('pagamentos', 'Pagamentos'), col('outras_saidas', 'Outras saídas'), ...(elimina ? [col('internas', 'Entre empresas do grupo (líquido)')] : []), col('saldo_periodo', 'Saldo do período'), col('saldoFinal', 'Saldo acumulado')],
      totais: { recebimentos: soma('recebimentos'), cartao: soma('cartao'), cheques: soma('cheques'), outras_entradas: soma('outras_entradas'), pagamentos: soma('pagamentos'), outras_saidas: soma('outras_saidas'), internas: soma('internas'), saldo_periodo: soma('saldo_periodo') } };
  }

  // projetado: o que está previsto, em faixas de 7 dias; o que já venceu cai na primeira linha
  const limite = new Date(Date.parse(hoje) + dias * 86_400_000).toISOString().slice(0, 10);
  const faixa = (campo: string) => `CASE WHEN ${campo} <= $2::date THEN 0 ELSE ((${campo} - $2::date - 1) / 7) + 1 END`;
  const fonte = async (sql: string) => new Map<number, number>((await c.query(sql, [empresaId, hoje, limite])).rows.map((r) => [Number(r.f), Number(r.v)]));
  const receber = await fonte(`SELECT ${faixa('vencimento')} AS f, sum(valor_centavos - pago_centavos)::bigint AS v FROM titulo_receber WHERE empresa_id = ANY($1::uuid[]) AND status IN ('ABERTO','PARCIAL') AND vencimento <= $3 GROUP BY 1`);
  const cartao = await fonte(`SELECT ${faixa('data_prevista')} AS f, sum(liquido_centavos)::bigint AS v FROM liquidacao_cartao WHERE empresa_id = ANY($1::uuid[]) AND status = 'PREVISTO' AND data_prevista <= $3 GROUP BY 1`);
  const cheques = await fonte(`SELECT ${faixa('bom_para')} AS f, sum(valor_centavos)::bigint AS v FROM cheque WHERE empresa_id = ANY($1::uuid[]) AND status IN ('RECEBIDO','DEPOSITADO') AND bom_para <= $3 GROUP BY 1`);
  const pagar = await fonte(`SELECT ${faixa('vencimento')} AS f, sum(valor_centavos - pago_centavos)::bigint AS v FROM titulo_pagar WHERE empresa_id = ANY($1::uuid[]) AND status IN ('PENDENTE','APROVADO','PARCIAL') AND vencimento <= $3 GROUP BY 1`);
  const faixas = Math.ceil(dias / 7);
  let acum = await saldoAte(hoje);
  const linhas: Linha[] = [{ periodo: 'Saldo de hoje', saldoAcumulado: acum, _negrito: true }];
  const tot = { receber: 0, cartao: 0, cheques: 0, pagar: 0 };
  for (let i = 0; i <= faixas; i++) {
    const ini = i === 0 ? null : new Date(Date.parse(hoje) + ((i - 1) * 7 + 1) * 86_400_000).toISOString().slice(0, 10);
    const fim = i === 0 ? null : new Date(Date.parse(hoje) + i * 7 * 86_400_000).toISOString().slice(0, 10);
    const r = receber.get(i) ?? 0, ca = cartao.get(i) ?? 0, ch = cheques.get(i) ?? 0, p = pagar.get(i) ?? 0;
    if (i > 0 && !r && !ca && !ch && !p) { acum += 0; }
    const saldo = r + ca + ch - p; acum += saldo;
    tot.receber += r; tot.cartao += ca; tot.cheques += ch; tot.pagar += p;
    linhas.push({ periodo: i === 0 ? 'Vencido e de hoje' : `${ini!.slice(8)}/${ini!.slice(5, 7)} a ${fim!.slice(8)}/${fim!.slice(5, 7)}`, receber: r, cartao: ca, cheques: ch, pagar: -p, saldo_periodo: saldo, saldoAcumulado: acum, _alerta: acum < 0 });
  }
  return { id: 'fluxo-caixa', titulo: `Fluxo de caixa projetado (${dias} dias)`, de: hoje, ate: limite, linhas,
    colunas: [col('periodo', 'Período', 'texto'), col('receber', 'A receber (laudos)'), col('cartao', 'Cartões'), col('cheques', 'Cheques'), col('pagar', 'A pagar (inclui aguardando aprovação)'), col('saldo_periodo', 'Saldo do período'), col('saldoAcumulado', 'Saldo projetado')],
    totais: { receber: tot.receber, cartao: tot.cartao, cheques: tot.cheques, pagar: -tot.pagar, saldo_periodo: tot.receber + tot.cartao + tot.cheques - tot.pagar } };
}
