import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { paraCsv, temPermissao, type ColunaRelatorio } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { gerarDre, gerarFluxo } from './demonstracoes';

export interface Relatorio { id: string; titulo: string; de?: string; ate?: string; colunas: ColunaRelatorio[]; linhas: Record<string, unknown>[]; totais: Record<string, unknown> | null }
export interface ParamsRelatorio { de?: string; ate?: string; agrupar?: string; dias?: number; escopo?: 'loja' | 'rede'; eliminar?: boolean }

const col = (chave: string, rotulo: string, tipo: ColunaRelatorio['tipo'] = 'texto'): ColunaRelatorio => ({ chave, rotulo, tipo });
const somar = (linhas: Record<string, unknown>[], chaves: string[]) => Object.fromEntries(chaves.map((k) => [k, linhas.reduce((s, l) => s + Number(l[k] ?? 0), 0)]));

export const RELATORIOS = [
  { id: 'laudos', titulo: 'Laudos por período', permissao: 'relatorio.operacional', agrupar: ['dia', 'cliente', 'servico', 'vistoriador', 'forma'] },
  { id: 'recebimentos', titulo: 'Recebimentos por período', permissao: 'relatorio.financeiro', agrupar: ['dia', 'forma', 'conta', 'cliente'] },
  { id: 'inadimplencia', titulo: 'Inadimplência por cliente (idade dos títulos)', permissao: 'relatorio.financeiro', agrupar: [] },
  { id: 'pagamentos', titulo: 'Pagamentos por período', permissao: 'relatorio.financeiro', agrupar: ['dia', 'fornecedor', 'conta', 'plano'] },
  { id: 'fluxo-caixa', titulo: 'Fluxo de caixa', permissao: 'relatorio.fluxo_caixa', agrupar: ['realizado', 'projetado'] },
  { id: 'dre', titulo: 'DRE (resultado do período)', permissao: 'relatorio.dre_balanco', agrupar: ['competencia', 'caixa'] },
] as const;

@Injectable()
export class RelatoriosService {
  constructor(private readonly db: DbService) {}

  /** Quais relatórios o perfil da loja ativa pode abrir. */
  async catalogo(a: Acesso) {
    const perfil = perfilEm(a, a.empresaAtivaId);
    if (!perfil || !a.empresaAtivaId) return [];
    const veDre = perfil === 'FINANCEIRO' ? await this.financeiroVeDre(a, a.empresaAtivaId) : false;
    return RELATORIOS.filter((r) => temPermissao(perfil, r.permissao) || (r.id === 'dre' && veDre)).map((r) => ({ id: r.id, titulo: r.titulo, agrupar: r.agrupar }));
  }

  /** A loja ativa, ou todas as lojas do grupo na visão consolidada. */
  private async lojas(c: import('pg').PoolClient, empresaId: string, rede: boolean): Promise<string[]> {
    return rede ? (await c.query('SELECT id FROM empresa')).rows.map((r) => r.id as string) : [empresaId];
  }

  /** O Financeiro só vê o DRE se o Administrativo liberou nas regras da loja. */
  private async financeiroVeDre(a: Acesso, empresaId: string): Promise<boolean> {
    return this.db.tenant(contextoDb(a), async (c) => (await c.query('SELECT financeiro_ve_dre AS v FROM empresa_config WHERE empresa_id = $1', [empresaId])).rows[0]?.v ?? false);
  }

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  async gerar(a: Acesso, id: string, p: ParamsRelatorio): Promise<Relatorio> {
    const def = RELATORIOS.find((r) => r.id === id);
    if (!def) throw new NotFoundException('Relatório não encontrado.');
    const empresaId = this.empresaAtiva(a);
    if (def.id === 'dre' && perfilEm(a, empresaId) === 'FINANCEIRO') { if (!(await this.financeiroVeDre(a, empresaId))) throw new ForbiddenException('O DRE não está liberado para o Financeiro desta loja. Peça ao Administrativo.'); }
    else exigir(a, def.permissao, empresaId);
    const hoje = hojeSP();
    const rede = p.escopo === 'rede';
    if (rede && (!a.rede || (id !== 'dre' && id !== 'fluxo-caixa'))) throw new ForbiddenException(a.rede ? 'O consolidado da rede vale para o DRE e o fluxo de caixa.' : 'O consolidado da rede é só para quem acessa todas as lojas (Administrativo).');
    const eliminar = rede && p.eliminar !== false;
    const ate = p.ate ?? hoje; const de = p.de ?? `${ate.slice(0, 8)}01`;
    if (id === 'fluxo-caixa' && (p.agrupar ?? 'realizado') === 'projetado') return this.db.tenant(contextoDb(a), async (c) => gerarFluxo(c, await this.lojas(c, empresaId, rede), hoje, hoje, 'projetado', hoje, Math.min(Math.max(p.dias ?? 60, 7), 180), eliminar));
    if (de > ate) throw new UnprocessableEntityException({ mensagem: 'O início do período não pode ser depois do fim.', campos: { de: 'Confira as datas.' } });
    if (Date.parse(ate) - Date.parse(de) > 400 * 86_400_000) throw new UnprocessableEntityException({ mensagem: 'Escolha um período de até 13 meses.', campos: { de: 'Período longo demais.' } });
    const agrupar = p.agrupar ?? def.agrupar[0];
    if (def.agrupar.length && !(def.agrupar as readonly string[]).includes(agrupar ?? '')) throw new UnprocessableEntityException({ mensagem: 'Agrupamento inválido para este relatório.', campos: { agrupar: 'Escolha uma das opções.' } });
    return this.db.tenant(contextoDb(a), async (c) => {
      const q = async (sql: string, params: unknown[]) => (await c.query(sql, params)).rows as Record<string, unknown>[];
      if (id === 'dre') { const r = await gerarDre(c, await this.lojas(c, empresaId, rede), de, ate, (agrupar as 'competencia' | 'caixa') ?? 'competencia', eliminar); return rede ? { ...r, titulo: `${r.titulo}, consolidado da rede${eliminar ? ' (sem o movimento entre empresas do grupo)' : ''}` } : r; }
      if (id === 'fluxo-caixa') { const r = await gerarFluxo(c, await this.lojas(c, empresaId, rede), de, ate, 'realizado', hoje, 0, eliminar); return rede ? { ...r, titulo: `${r.titulo}, consolidado da rede` } : r; }
      if (id === 'laudos') {
        const dim: Record<string, [string, string, ColunaRelatorio['tipo']]> = {
          dia: ['l.data_laudo::text', 'Data', 'data'], cliente: ['cl.nome', 'Cliente', 'texto'], servico: ['s.nome', 'Serviço', 'texto'], vistoriador: ['v.nome', 'Vistoriador', 'texto'], forma: ['fp.nome', 'Forma de pagamento', 'texto'],
        };
        const [expr, rotulo, tipo] = dim[agrupar!]!;
        const margem = temPermissao(perfilEm(a, empresaId)!, 'relatorio.margem');
        const linhas = await q(
          `SELECT ${expr} AS grupo, count(*)::int AS laudos, sum(l.valor_cobrado_centavos)::bigint AS valor,
                  sum(coalesce(l.preco_tabela_centavos, l.valor_cobrado_centavos) - l.valor_cobrado_centavos)::bigint AS desconto,
                  count(*) FILTER (WHERE l.preco_manual)::int AS manuais
                  ${margem ? `, coalesce(sum((SELECT sum(lc.valor_centavos) FROM laudo_custo lc WHERE lc.laudo_id = l.id AND lc.ativo)), 0)::bigint AS custos` : ''}
             FROM laudo l JOIN cliente cl ON cl.id = l.cliente_id JOIN servico s ON s.id = l.servico_id JOIN vistoriador v ON v.id = l.vistoriador_id JOIN forma_pagamento fp ON fp.id = l.forma_pagamento_id
            WHERE l.empresa_id = $1 AND l.status = 'ATIVO' AND l.data_laudo BETWEEN $2 AND $3 GROUP BY 1 ORDER BY ${agrupar === 'dia' ? '1' : 'valor DESC'}`, [empresaId, de, ate]);
        const colunas = [col('grupo', rotulo, tipo), col('laudos', 'Laudos', 'inteiro'), col('valor', 'Valor cobrado', 'dinheiro'), col('desconto', 'Descontos', 'dinheiro'), col('manuais', 'Preço manual', 'inteiro')];
        const somas = ['laudos', 'valor', 'desconto', 'manuais'];
        if (margem) {
          for (const l of linhas) l.margem = Number(l.valor) - Number(l.custos);
          colunas.push(col('custos', 'Custos', 'dinheiro'), col('margem', 'Margem', 'dinheiro')); somas.push('custos', 'margem');
        }
        return { id, titulo: def.titulo, de, ate, colunas, linhas, totais: somar(linhas, somas) };
      }
      if (id === 'recebimentos') {
        const dim: Record<string, [string, string, ColunaRelatorio['tipo']]> = {
          dia: ['b.data::text', 'Data', 'data'], forma: ['fp.nome', 'Forma de pagamento', 'texto'], conta: [`coalesce(cf.nome, 'Sem conta')`, 'Conta', 'texto'], cliente: ['cl.nome', 'Cliente', 'texto'],
        };
        const [expr, rotulo, tipo] = dim[agrupar!]!;
        const linhas = await q(
          `SELECT ${expr} AS grupo, count(*) FILTER (WHERE b.estorno_de IS NULL)::int AS baixas, sum(b.principal_centavos)::bigint AS principal,
                  sum(b.multa_centavos + b.juros_centavos - b.perdao_centavos)::bigint AS encargos, sum(b.recebido_centavos)::bigint AS recebido
             FROM baixa_receber b JOIN titulo_receber t ON t.id = b.titulo_id JOIN cliente cl ON cl.id = t.cliente_id JOIN forma_pagamento fp ON fp.id = b.forma_pagamento_id LEFT JOIN conta_financeira cf ON cf.id = b.conta_id
            WHERE b.empresa_id = $1 AND b.data BETWEEN $2 AND $3 GROUP BY 1 ORDER BY ${agrupar === 'dia' ? '1' : 'recebido DESC'}`, [empresaId, de, ate]);
        return { id, titulo: def.titulo, de, ate, colunas: [col('grupo', rotulo, tipo), col('baixas', 'Baixas', 'inteiro'), col('principal', 'Valor dos títulos', 'dinheiro'), col('encargos', 'Multa e juros (líquido)', 'dinheiro'), col('recebido', 'Recebido', 'dinheiro')], linhas, totais: somar(linhas, ['baixas', 'principal', 'encargos', 'recebido']) };
      }
      if (id === 'inadimplencia') {
        const linhas = await q(
          `SELECT cl.nome AS grupo, count(*)::int AS titulos,
                  sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE t.vencimento >= $2)::bigint AS a_vencer,
                  sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE $2::date - t.vencimento BETWEEN 1 AND 30)::bigint AS d30,
                  sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE $2::date - t.vencimento BETWEEN 31 AND 60)::bigint AS d60,
                  sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE $2::date - t.vencimento BETWEEN 61 AND 90)::bigint AS d90,
                  sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE $2::date - t.vencimento > 90)::bigint AS mais90,
                  sum(t.valor_centavos - t.pago_centavos)::bigint AS total
             FROM titulo_receber t JOIN cliente cl ON cl.id = t.cliente_id WHERE t.empresa_id = $1 AND t.status IN ('ABERTO','PARCIAL') GROUP BY cl.nome ORDER BY total DESC`, [empresaId, hoje]);
        const lin = linhas.map((l) => ({ ...l, a_vencer: Number(l.a_vencer ?? 0), d30: Number(l.d30 ?? 0), d60: Number(l.d60 ?? 0), d90: Number(l.d90 ?? 0), mais90: Number(l.mais90 ?? 0) }));
        return { id, titulo: def.titulo, ate: hoje, colunas: [col('grupo', 'Cliente'), col('titulos', 'Títulos', 'inteiro'), col('a_vencer', 'A vencer', 'dinheiro'), col('d30', 'Vencido até 30 dias', 'dinheiro'), col('d60', '31 a 60 dias', 'dinheiro'), col('d90', '61 a 90 dias', 'dinheiro'), col('mais90', 'Mais de 90 dias', 'dinheiro'), col('total', 'Total em aberto', 'dinheiro')], linhas: lin, totais: somar(lin, ['titulos', 'a_vencer', 'd30', 'd60', 'd90', 'mais90', 'total']) };
      }
      // pagamentos
      const dim: Record<string, [string, string, ColunaRelatorio['tipo']]> = {
        dia: ['p.data::text', 'Data', 'data'], fornecedor: [`coalesce(f.nome, t.beneficiario)`, 'Favorecido', 'texto'], conta: ['cf.nome', 'Conta bancária', 'texto'], plano: [`coalesce(pc.codigo || ' ' || pc.nome, 'Sem classificação')`, 'Conta do plano', 'texto'],
      };
      const [expr, rotulo, tipo] = dim[agrupar!]!;
      const linhas = await q(
        `SELECT ${expr} AS grupo, count(*) FILTER (WHERE p.estorno_de IS NULL)::int AS pagamentos, sum(p.principal_centavos)::bigint AS principal, sum(p.juros_centavos + p.multa_centavos - p.desconto_centavos)::bigint AS encargos, sum(p.pago_total_centavos)::bigint AS pago
           FROM pagamento_pagar p JOIN titulo_pagar t ON t.id = p.titulo_id LEFT JOIN fornecedor f ON f.id = t.fornecedor_id LEFT JOIN plano_conta pc ON pc.id = t.plano_conta_id JOIN conta_financeira cf ON cf.id = p.conta_id
          WHERE p.empresa_id = $1 AND p.data BETWEEN $2 AND $3 GROUP BY 1 ORDER BY ${agrupar === 'dia' ? '1' : 'pago DESC'}`, [empresaId, de, ate]);
      return { id, titulo: def.titulo, de, ate, colunas: [col('grupo', rotulo, tipo), col('pagamentos', 'Pagamentos', 'inteiro'), col('principal', 'Valor das contas', 'dinheiro'), col('encargos', 'Juros, multa e desconto (líquido)', 'dinheiro'), col('pago', 'Pago', 'dinheiro')], linhas, totais: somar(linhas, ['pagamentos', 'principal', 'encargos', 'pago']) };
    });
  }

  /** Exportação: gera o CSV e registra quem exportou, o quê e quantas linhas (LGPD). */
  async exportarCsv(a: Acesso, id: string, p: ParamsRelatorio): Promise<{ nome: string; csv: string }> {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'exportar', empresaId);
    const r = await this.gerar(a, id, p);
    await this.db.tenant(contextoDb(a), (c) => auditar(c, a, { acao: 'relatorio.exportado', entidade: 'relatorio', entidadeId: id, empresaId, depois: { relatorio: r.titulo, de: r.de, ate: r.ate, agrupar: p.agrupar, linhas: r.linhas.length, formato: 'csv' } }));
    return { nome: `${id}-${r.de ?? r.ate}-${r.ate}.csv`.replace(/[^a-z0-9.\-_]/gi, '_'), csv: paraCsv(r.colunas, r.linhas, r.linhas.length ? r.totais : null) };
  }
}
