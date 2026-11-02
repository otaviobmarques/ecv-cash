import type { PoolClient } from 'pg';
import type { ColunaRelatorio } from '@ecv/shared';
import type { Relatorio } from './relatorios.service';

/** Contas do plano que o próprio sistema calcula: não aceitam saldo informado à mão (senão contaria duas vezes). */
export const CODIGOS_AUTOMATICOS = ['6.1', '6.2', '7.1'];
type Linha = Record<string, unknown>;
const col = (chave: string, rotulo: string, tipo: ColunaRelatorio['tipo'] = 'dinheiro'): ColunaRelatorio => ({ chave, rotulo, tipo });

/** Posição patrimonial gerencial na data: o que a loja tem (ativo), o que deve (passivo) e a diferença (patrimônio líquido). */
export async function gerarBalanco(c: PoolClient, empresaIds: string[], data: string, elimina: boolean): Promise<Relatorio> {
  const n = async (sql: string, p: unknown[] = []) => Number((await c.query(sql, [empresaIds, data, ...p])).rows[0].v ?? 0);
  const clienteInterno = elimina ? `AND NOT EXISTS (SELECT 1 FROM cliente zc WHERE zc.id = t.cliente_id AND zc.empresa_vinculada_id IS NOT NULL)` : '';
  const fornecedorInterno = elimina ? `AND NOT EXISTS (SELECT 1 FROM fornecedor zf WHERE zf.id = t.fornecedor_id AND zf.empresa_vinculada_id IS NOT NULL)` : '';

  const contas = (await c.query(
    `SELECT cf.nome, e.nome_fantasia AS loja,
            (CASE WHEN cf.data_saldo_inicial <= $2 THEN cf.saldo_inicial_centavos ELSE 0 END + coalesce((SELECT sum(l.valor_centavos) FROM lancamento_financeiro l WHERE l.conta_id = cf.id AND l.data <= $2), 0))::bigint AS v
       FROM conta_financeira cf JOIN empresa e ON e.id = cf.empresa_id WHERE cf.empresa_id = ANY($1::uuid[]) AND cf.status = 'ATIVO' ORDER BY e.nome_fantasia, cf.nome`, [empresaIds, data])).rows as { nome: string; loja: string; v: number }[];
  const receber = await n(
    `SELECT sum(t.valor_centavos - coalesce((SELECT sum(b.principal_centavos) FROM baixa_receber b WHERE b.titulo_id = t.id AND b.data <= $2), 0))::bigint AS v
       FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id WHERE t.empresa_id = ANY($1::uuid[]) AND l.data_laudo <= $2 AND (t.status <> 'CANCELADO' OR t.cancelado_em::date > $2) ${clienteInterno}`);
  const cartoes = await n(
    `SELECT sum(q.liquido_centavos)::bigint AS v FROM liquidacao_cartao q JOIN baixa_receber b ON b.id = q.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id
      WHERE q.empresa_id = ANY($1::uuid[]) AND q.data_venda <= $2 AND (q.status = 'PREVISTO' OR (q.status = 'LIQUIDADO' AND q.data_liquidacao > $2)) ${clienteInterno}`);
  const cheques = await n(
    `SELECT sum(k.valor_centavos)::bigint AS v FROM cheque k JOIN baixa_receber b ON b.id = k.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id
      WHERE k.empresa_id = ANY($1::uuid[]) AND b.data <= $2 AND (k.status IN ('RECEBIDO','DEPOSITADO') OR (k.status = 'COMPENSADO' AND k.compensado_em > $2) OR (k.status = 'DEVOLVIDO' AND k.devolvido_em > $2)) ${clienteInterno}`);
  const pagar = await n(
    `SELECT sum(t.valor_centavos - coalesce((SELECT sum(p.principal_centavos) FROM pagamento_pagar p WHERE p.titulo_id = t.id AND p.data <= $2), 0))::bigint AS v
       FROM titulo_pagar t WHERE t.empresa_id = ANY($1::uuid[]) AND t.competencia <= $2 AND t.status <> 'RASCUNHO' AND (t.status <> 'CANCELADO' OR t.cancelado_em::date > $2) ${fornecedorInterno}`);

  // saldos informados à mão: o mais recente até a data, por loja e conta do plano
  const manuais = (await c.query(
    `SELECT DISTINCT ON (s.empresa_id, s.plano_conta_id) pc.tipo, pc.codigo, pc.nome, s.valor_centavos::bigint AS v
       FROM saldo_patrimonial_manual s JOIN plano_conta pc ON pc.id = s.plano_conta_id WHERE s.empresa_id = ANY($1::uuid[]) AND s.data_base <= $2 ORDER BY s.empresa_id, s.plano_conta_id, s.data_base DESC`, [empresaIds, data])).rows as { tipo: string; codigo: string; nome: string; v: number }[];
  const porConta = (tipo: string) => { const m = new Map<string, number>(); for (const x of manuais.filter((y) => y.tipo === tipo)) m.set(`${x.codigo} ${x.nome}`, (m.get(`${x.codigo} ${x.nome}`) ?? 0) + Number(x.v)); return [...m.entries()]; };

  const linhas: Linha[] = [];
  const add = (linha: string, valor: number | null, extra: Linha = {}) => linhas.push({ linha, valor, ...extra });
  const totalCaixa = contas.reduce((s, x) => s + Number(x.v), 0);
  add('ATIVO', null, { _negrito: true });
  add('Caixa e bancos', totalCaixa);
  const multiLoja = new Set(contas.map((x) => x.loja)).size > 1;
  for (const x of contas) add(multiLoja ? `${x.loja}: ${x.nome}` : x.nome, Number(x.v), { _sub: true });
  add('Contas a receber (laudos em aberto)', receber);
  add('Cartões a receber da operadora (líquido de taxas)', cartoes);
  add('Cheques em carteira', cheques);
  const ativoManual = porConta('ATIVO');
  if (ativoManual.length) { add('Outros ativos (informados)', ativoManual.reduce((s, [, v]) => s + v, 0)); for (const [k, v] of ativoManual) add(k, v, { _sub: true }); }
  const totalAtivo = totalCaixa + receber + cartoes + cheques + ativoManual.reduce((s, [, v]) => s + v, 0);
  add('Total do ativo', totalAtivo, { _negrito: true });
  add('PASSIVO', null, { _negrito: true });
  add('Contas a pagar', pagar);
  const passivoManual = porConta('PASSIVO');
  if (passivoManual.length) { add('Outros passivos (informados)', passivoManual.reduce((s, [, v]) => s + v, 0)); for (const [k, v] of passivoManual) add(k, v, { _sub: true }); }
  const totalPassivo = pagar + passivoManual.reduce((s, [, v]) => s + v, 0);
  add('Total do passivo', totalPassivo, { _negrito: true });
  add('PATRIMÔNIO LÍQUIDO', null, { _negrito: true });
  const plManual = porConta('PATRIMONIO'); const somaPl = plManual.reduce((s, [, v]) => s + v, 0);
  for (const [k, v] of plManual) add(k, v);
  const plTotal = totalAtivo - totalPassivo;
  add('Resultado acumulado e demais diferenças (calculado)', plTotal - somaPl);
  add('Total do patrimônio líquido', plTotal, { _negrito: true });
  add('Total do passivo + patrimônio líquido', totalPassivo + plTotal, { _negrito: true });
  return { id: 'balanco', titulo: 'Balanço gerencial', ate: data, colunas: [col('linha', 'Conta', 'texto'), col('valor', `Posição em ${data.split('-').reverse().join('/')}`)], linhas, totais: null };
}
