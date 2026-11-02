import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { calcularAtraso, formatarBRL, gerarPixCopiaECola, temPermissao, type baixaFaturaSchema, type editarFaturaSchema, type filtroFaturasSchema, type gerarFaturasSchema, type previaFaturasSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { executarBaixa } from '../receber/baixa';
import { recalcularTitulo } from '../receber/titulo';
import { gerarPdfFatura } from './fatura-pdf';

const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });
const somarDias = (s: string, n: number) => new Date(Date.parse(s) + n * 86_400_000).toISOString().slice(0, 10);

const COLS_FATURA = `f.id, f.empresa_id AS "empresaId", f.cliente_id AS "clienteId", cl.nome AS cliente, f.numero::int AS numero, f.periodo_ini::text AS "periodoIni", f.periodo_fim::text AS "periodoFim",
  f.emissao::text AS emissao, f.vencimento::text AS vencimento, f.total_centavos AS "totalCentavos", f.status, f.multa_bp AS "multaBp", f.juros_mes_bp AS "jurosMesBp",
  f.numero_nf AS "numeroNf", f.numero_boleto AS "numeroBoleto", f.observacao, f.motivo_cancelamento AS "motivoCancelamento", f.cancelado_em AS "canceladoEm", f.criado_em AS "criadoEm"`;

export interface ContaFatura { nome: string; banco: string | null; agencia: string | null; conta: string | null; tipoConta: string | null; titular: string | null; documentoTitular: string | null; pixTipo: string | null; pixChave: string | null }

@Injectable()
export class FaturasService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  /** Clientes que têm títulos faturáveis no período: abertos, de forma "faturada", ainda fora de fatura. */
  async previa(a: Acesso, d: z.output<typeof previaFaturasSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'fatura.gerar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const rows = (await c.query(
        `SELECT cl.id AS "clienteId", cl.nome AS cliente, cl.periodicidade, cl.prazo_dias AS "prazoDias", count(*)::int AS titulos, sum(t.valor_centavos)::bigint AS "totalCentavos",
                min(l.data_laudo)::text AS "primeiroLaudo", max(l.data_laudo)::text AS "ultimoLaudo"
           FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id JOIN cliente cl ON cl.id = t.cliente_id JOIN forma_pagamento fp ON fp.id = t.forma_pagamento_id
          WHERE t.empresa_id = $1 AND t.status = 'ABERTO' AND t.fatura_id IS NULL AND fp.gera_fatura AND l.data_laudo BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR t.cliente_id = $4)
          GROUP BY cl.id ORDER BY cl.nome`, [empresaId, d.periodoIni, d.periodoFim, d.clienteId ?? null])).rows;
      return { periodoIni: d.periodoIni, periodoFim: d.periodoFim, clientes: rows };
    });
  }

  private async gerarUma(c: PoolClient, a: Acesso, empresaId: string, clienteId: string, d: z.output<typeof gerarFaturasSchema>) {
    const hoje = hojeSP();
    const emissao = d.emissao ?? hoje;
    const cl = (await c.query('SELECT nome, prazo_dias AS "prazoDias", multa_bp AS "multaBp", juros_mes_bp AS "jurosMesBp", status FROM cliente WHERE id = $1', [clienteId])).rows[0];
    if (!cl) throw new NotFoundException('Cliente não encontrado.');
    const titulos = (await c.query(
      `SELECT t.id, t.valor_centavos AS valor FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id JOIN forma_pagamento fp ON fp.id = t.forma_pagamento_id
        WHERE t.empresa_id = $1 AND t.cliente_id = $2 AND t.status = 'ABERTO' AND t.fatura_id IS NULL AND fp.gera_fatura AND l.data_laudo BETWEEN $3 AND $4
        ORDER BY l.data_laudo, l.numero_interno FOR UPDATE OF t`, [empresaId, clienteId, d.periodoIni, d.periodoFim])).rows as { id: string; valor: number }[];
    if (titulos.length === 0) throw new ConflictException(`${cl.nome}: não há títulos faturáveis neste período.`);
    const total = titulos.reduce((s, t) => s + t.valor, 0);
    const vencimento = d.vencimento ?? somarDias(emissao, cl.prazoDias);
    if (vencimento < emissao) throw erroCampo('vencimento', 'O vencimento não pode ser antes da emissão.');
    const f = (await c.query(
      `INSERT INTO fatura (grupo_id, empresa_id, cliente_id, periodo_ini, periodo_fim, emissao, vencimento, total_centavos, multa_bp, juros_mes_bp, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, numero::int AS numero`,
      [a.grupoId, empresaId, clienteId, d.periodoIni, d.periodoFim, emissao, vencimento, total, cl.multaBp, cl.jurosMesBp, a.usuarioId])).rows[0];
    await c.query('UPDATE titulo_receber SET fatura_id = $2, vencimento = $3 WHERE id = ANY($1::uuid[])', [titulos.map((t) => t.id), f.id, vencimento]);
    for (const t of titulos) await recalcularTitulo(c, t.id); // trava os laudos
    await auditar(c, a, { acao: 'fatura.gerada', entidade: 'fatura', entidadeId: f.id, empresaId, depois: { numero: f.numero, cliente: cl.nome, periodo: `${d.periodoIni} a ${d.periodoFim}`, titulos: titulos.length, totalCentavos: total, vencimento } });
    return { id: f.id, numero: f.numero, cliente: cl.nome, titulos: titulos.length, totalCentavos: total, vencimento };
  }

  /** Cada cliente vira uma fatura numa transação própria: um problema não derruba os demais. */
  async gerar(a: Acesso, d: z.output<typeof gerarFaturasSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'fatura.gerar', empresaId);
    if (d.periodoFim > hojeSP()) throw erroCampo('periodoFim', 'O período ainda não terminou: escolha uma data até hoje.');
    if (d.emissao && d.emissao > hojeSP()) throw erroCampo('emissao', 'A emissão não pode ser futura.');
    const resultados: { clienteId: string; ok: boolean; fatura?: unknown; erro?: string }[] = [];
    for (const clienteId of d.clienteIds) {
      try {
        const fatura = await this.db.tenant(contextoDb(a), (c) => this.gerarUma(c, a, empresaId, clienteId, d));
        resultados.push({ clienteId, ok: true, fatura });
      } catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { mensagem?: string; message?: string } | string | undefined;
        if (!resp) throw e;
        resultados.push({ clienteId, ok: false, erro: typeof resp === 'string' ? resp : resp.mensagem ?? resp.message ?? 'Não foi possível gerar esta fatura.' });
      }
    }
    return { geradas: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).length, resultados };
  }

  async listar(a: Acesso, f: z.output<typeof filtroFaturasSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const onde = ['f.empresa_id = $1']; const p: unknown[] = [empresaId];
      const add = (sql: string, v: unknown) => { p.push(v); onde.push(sql.replace('?', `$${p.length}`)); };
      if (f.situacao === 'abertas') onde.push(`f.status IN ('ABERTA','PARCIAL')`);
      if (f.situacao === 'vencidas') { p.push(hoje); onde.push(`f.status IN ('ABERTA','PARCIAL') AND f.vencimento < $${p.length}`); }
      if (f.situacao === 'pagas') onde.push(`f.status = 'PAGA'`);
      if (f.situacao === 'canceladas') onde.push(`f.status = 'CANCELADA'`);
      if (f.clienteId) add('f.cliente_id = ?', f.clienteId);
      if (f.de) add('f.emissao >= ?', f.de);
      if (f.ate) add('f.emissao <= ?', f.ate);
      const base = `FROM fatura f JOIN cliente cl ON cl.id = f.cliente_id WHERE ${onde.join(' AND ')}`;
      const tot = (await c.query(`SELECT count(*)::int AS n ${base}`, p)).rows[0].n;
      p.push(f.limite, f.pagina * f.limite);
      const rows = (await c.query(
        `SELECT ${COLS_FATURA},
                coalesce((SELECT sum(t.valor_centavos - t.pago_centavos) FROM titulo_receber t WHERE t.fatura_id = f.id AND t.status <> 'CANCELADO'), 0)::bigint AS "saldoCentavos"
           ${base} ORDER BY f.emissao DESC, f.numero DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
      return { itens: rows.map((r) => ({ ...r, vencida: (r.status === 'ABERTA' || r.status === 'PARCIAL') && r.vencimento < hoje })), total: tot, hoje };
    });
  }

  private async ler(c: PoolClient, id: string) {
    const f = (await c.query(`SELECT ${COLS_FATURA} FROM fatura f JOIN cliente cl ON cl.id = f.cliente_id WHERE f.id = $1`, [id])).rows[0];
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    return f as Record<string, unknown> & { id: string; empresaId: string; status: string; vencimento: string; totalCentavos: number; multaBp: number; jurosMesBp: number };
  }

  /** Títulos da fatura com o que falta pagar e os encargos calculados para a data. */
  private async titulosDaFatura(c: PoolClient, f: { id: string; vencimento: string; multaBp: number; jurosMesBp: number }, data: string) {
    const rows = (await c.query(
      `SELECT t.id, l.numero_interno::int AS numero, l.numero_laudo AS "numeroLaudo", l.placa, l.data_laudo::text AS "dataLaudo", s.nome AS servico, t.valor_centavos AS "valorCentavos",
              t.pago_centavos AS "pagoCentavos", t.status
         FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id JOIN servico s ON s.id = l.servico_id
        WHERE t.fatura_id = $1 ORDER BY l.data_laudo, l.numero_interno`, [f.id])).rows;
    return rows.map((t) => {
      const saldo = t.status === 'CANCELADO' ? 0 : t.valorCentavos - t.pagoCentavos;
      const at = calcularAtraso(saldo, f.vencimento, data, { multaBp: f.multaBp, jurosMesBp: f.jurosMesBp });
      return { ...t, saldoCentavos: saldo, multaCentavos: at.multa, jurosCentavos: at.juros };
    });
  }

  async detalhe(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = await this.ler(c, id);
      exigir(a, 'receber.ver', f.empresaId);
      const hoje = hojeSP();
      const titulos = await this.titulosDaFatura(c, f, hoje);
      const saldo = titulos.reduce((s, t) => s + t.saldoCentavos, 0);
      const enc = titulos.reduce((s, t) => s + t.multaCentavos + t.jurosCentavos, 0);
      const recebido = Number((await c.query(`SELECT coalesce(sum(b.recebido_centavos), 0) AS v FROM baixa_receber b JOIN titulo_receber t ON t.id = b.titulo_id WHERE t.fatura_id = $1`, [id])).rows[0].v);
      return { ...f, titulos, saldoCentavos: saldo, encargosCentavos: enc, totalHojeCentavos: saldo + enc, recebidoCentavos: recebido, vencida: (f.status === 'ABERTA' || f.status === 'PARCIAL') && f.vencimento < hoje, diasAtraso: Math.max(0, Math.round((Date.parse(hoje) - Date.parse(f.vencimento)) / 86_400_000)) };
    });
  }

  /**
   * Baixa da fatura: o valor recebido (do principal) é distribuído nos títulos em ordem de data do laudo;
   * multa e juros acompanham cada parte paga. Sem informar valor, quita tudo.
   */
  async baixar(a: Acesso, id: string, d: z.output<typeof baixaFaturaSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = await this.ler(c, id);
      exigir(a, 'receber.baixar', f.empresaId);
      if (f.status === 'CANCELADA') throw new ConflictException('Esta fatura está cancelada.');
      if (f.status === 'PAGA') throw new ConflictException('Esta fatura já está paga.');
      await c.query('SELECT 1 FROM titulo_receber WHERE fatura_id = $1 ORDER BY id FOR UPDATE', [id]);
      const titulos = (await this.titulosDaFatura(c, f, d.data ?? hojeSP())).filter((t) => t.saldoCentavos > 0);
      const saldoTotal = titulos.reduce((s, t) => s + t.saldoCentavos, 0);
      let restante = d.principalCentavos ?? saldoTotal;
      if (restante > saldoTotal) throw erroCampo('principalCentavos', `O valor passa do saldo da fatura (${formatarBRL(saldoTotal)}).`);
      const lote = crypto.randomUUID();
      const baixas: unknown[] = [];
      let recebido = 0;
      for (const t of titulos) {
        if (restante <= 0) break;
        const parte = Math.min(restante, t.saldoCentavos);
        const b = await executarBaixa(c, a, { tituloId: t.id, principalCentavos: parte, data: d.data, contaId: d.contaId, formaPagamentoId: d.formaPagamentoId, perdoarEncargos: d.perdoarEncargos, motivo: d.motivo, loteId: lote });
        baixas.push(b); recebido += b.recebidoCentavos; restante -= parte;
      }
      const status = (await c.query('SELECT status FROM fatura WHERE id = $1', [id])).rows[0].status;
      await auditar(c, a, { acao: 'fatura.baixa', entidade: 'fatura', entidadeId: id, empresaId: f.empresaId, depois: { numero: f.numero, recebidoCentavos: recebido, titulos: baixas.length, statusFatura: status }, motivo: d.motivo });
      return { lote, recebidoCentavos: recebido, titulosBaixados: baixas.length, status };
    });
  }

  async cancelar(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = await this.ler(c, id);
      exigir(a, 'fatura.cancelar', f.empresaId);
      if (f.status === 'CANCELADA') throw new ConflictException('Esta fatura já está cancelada.');
      const ts = (await c.query(
        `SELECT t.id, t.pago_centavos AS pago, l.data_laudo::text AS "dataLaudo", cl.prazo_dias AS prazo FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id JOIN cliente cl ON cl.id = t.cliente_id WHERE t.fatura_id = $1 FOR UPDATE OF t`, [id])).rows;
      if (ts.some((t) => t.pago > 0)) throw new ConflictException('Esta fatura já recebeu baixa. Estorne as baixas antes de cancelar.');
      for (const t of ts) {
        await c.query('UPDATE titulo_receber SET fatura_id = NULL, vencimento = $2 WHERE id = $1', [t.id, somarDias(t.dataLaudo, t.prazo)]);
        await recalcularTitulo(c, t.id); // destrava o laudo
      }
      await c.query(`UPDATE fatura SET status = 'CANCELADA', cancelado_em = now(), cancelado_por = $2, motivo_cancelamento = $3 WHERE id = $1`, [id, a.usuarioId, motivo]);
      await auditar(c, a, { acao: 'fatura.cancelada', entidade: 'fatura', entidadeId: id, empresaId: f.empresaId, depois: { numero: f.numero, titulosLiberados: ts.length }, motivo });
      return { ok: true, titulosLiberados: ts.length };
    });
  }

  async editar(a: Acesso, id: string, d: z.output<typeof editarFaturaSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = await this.ler(c, id);
      exigir(a, 'fatura.gerar', f.empresaId);
      if (f.status === 'CANCELADA') throw new ConflictException('Fatura cancelada não pode ser alterada.');
      await c.query(
        `UPDATE fatura SET numero_nf = CASE WHEN $2::boolean THEN $3 ELSE numero_nf END, numero_boleto = CASE WHEN $4::boolean THEN $5 ELSE numero_boleto END, observacao = CASE WHEN $6::boolean THEN $7 ELSE observacao END WHERE id = $1`,
        [id, d.numeroNf !== undefined, d.numeroNf ?? null, d.numeroBoleto !== undefined, d.numeroBoleto ?? null, d.observacao !== undefined, d.observacao ?? null]);
      await auditar(c, a, { acao: 'fatura.referencias_alteradas', entidade: 'fatura', entidadeId: id, empresaId: f.empresaId, antes: { numeroNf: f.numeroNf, numeroBoleto: f.numeroBoleto }, depois: d });
      return this.ler(c, id);
    });
  }

  /** Contas marcadas para aparecer na fatura, como estão agora. */
  async contasDaFatura(c: PoolClient, empresaId: string): Promise<ContaFatura[]> {
    return (await c.query(
      `SELECT nome, banco, agencia, conta, tipo_conta AS "tipoConta", titular, documento_titular AS "documentoTitular", pix_tipo AS "pixTipo", pix_chave AS "pixChave"
         FROM conta_financeira WHERE empresa_id = $1 AND exibir_na_fatura AND status = 'ATIVO' ORDER BY (pix_chave IS NULL), nome`, [empresaId])).rows;
  }

  /** PIX copia e cola da fatura: valor = o que falta pagar hoje, com multa e juros. */
  async pix(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = await this.ler(c, id);
      exigir(a, 'receber.ver', f.empresaId);
      return this.pixDaFatura(c, f);
    });
  }

  async pixDaFatura(c: PoolClient, f: { id: string; empresaId: string; vencimento: string; multaBp: number; jurosMesBp: number; numero?: unknown }) {
    const titulos = await this.titulosDaFatura(c, f, hojeSP());
    const valor = titulos.reduce((s, t) => s + t.saldoCentavos + t.multaCentavos + t.jurosCentavos, 0);
    const contas = await this.contasDaFatura(c, f.empresaId);
    const conta = contas.find((x) => x.pixChave && x.pixTipo);
    const emp = (await c.query('SELECT razao_social AS razao, nome_fantasia AS fantasia, cidade FROM empresa WHERE id = $1', [f.empresaId])).rows[0];
    if (!conta || valor <= 0) return { disponivel: false as const, valorCentavos: valor, contas };
    const copiaECola = gerarPixCopiaECola({ tipoChave: conta.pixTipo as never, chave: conta.pixChave!, nomeRecebedor: conta.titular ?? emp.razao, cidade: emp.cidade, valorCentavos: valor, identificador: `FAT${f.numero}` });
    return { disponivel: true as const, valorCentavos: valor, copiaECola, conta: conta.nome, titular: conta.titular, contas };
  }

  /** PDF da fatura, com o logo da loja quando existir, as cores do tema e o bloco "Como pagar". */
  async pdf(a: Acesso, id: string): Promise<{ nome: string; pdf: Buffer }> {
    const dados = await this.db.tenant(contextoDb(a), async (c) => {
      const f = await this.ler(c, id);
      exigir(a, 'receber.ver', f.empresaId);
      const hoje = hojeSP();
      const titulos = await this.titulosDaFatura(c, f, hoje);
      const aberto = f.status === 'ABERTA' || f.status === 'PARCIAL';
      const saldo = titulos.reduce((s, t) => s + t.saldoCentavos, 0);
      const enc = aberto ? titulos.reduce((s, t) => s + t.multaCentavos + t.jurosCentavos, 0) : 0;
      const recebido = Number((await c.query(`SELECT coalesce(sum(b.principal_centavos), 0) AS v FROM baixa_receber b JOIN titulo_receber t ON t.id = b.titulo_id WHERE t.fatura_id = $1`, [id])).rows[0].v);
      const emp = (await c.query('SELECT razao_social AS razao, nome_fantasia AS fantasia, cnpj, cidade, uf, email_financeiro AS email FROM empresa WHERE id = $1', [f.empresaId])).rows[0];
      const cor = (await c.query(`SELECT cor_primaria AS cor FROM tema WHERE empresa_id = $1 OR empresa_id IS NULL ORDER BY empresa_id NULLS LAST LIMIT 1`, [f.empresaId])).rows[0]?.cor ?? '#104B3A';
      const contas = aberto ? await this.contasDaFatura(c, f.empresaId) : [];
      const pix = aberto ? await this.pixDaFatura(c, f) : null;
      return {
        empresa: emp, cor,
        fatura: { ...(f as never as DadosFatura), diasAtraso: Math.max(0, Math.round((Date.parse(hoje) - Date.parse(f.vencimento)) / 86_400_000)) },
        titulos: titulos.filter((t) => t.status !== 'CANCELADO'), totalCentavos: f.totalCentavos, recebidoCentavos: recebido, saldoCentavos: saldo, encargosCentavos: enc, totalHojeCentavos: saldo + enc,
        contas, pix: pix && pix.disponivel ? { copiaECola: pix.copiaECola, valorCentavos: pix.valorCentavos } : null,
        geradoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        numero: f.numero as number, cliente: f.cliente as string,
      };
    });
    const { numero, cliente, ...resto } = dados;
    const pdf = await gerarPdfFatura(resto as never);
    return { nome: `fatura-${numero}-${String(cliente).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`, pdf };
  }
}
type DadosFatura = { numero: number; cliente: string; periodoIni: string; periodoFim: string; emissao: string; vencimento: string; status: string; numeroNf: string | null; numeroBoleto: string | null; observacao: string | null; diasAtraso: number };
void BadRequestException; void temPermissao; void perfilEm;
