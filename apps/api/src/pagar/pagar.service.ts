import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { formatarBRL, ratear, temPermissao, type apurarCustosSchema, type editarTituloPagarSchema, type filtroPagarSchema, type pagamentoPagarSchema, type rateioSchema, type recorrenciaSchema, type tituloPagarSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { estornarLancamento, hojeSP, registrarLancamento, saldoDaConta, ultimoDiaFechado } from '../caixa/razao';
import { datasDaRecorrencia } from './recorrencia';

type Titulo = z.output<typeof tituloPagarSchema>;
type Filtro = z.output<typeof filtroPagarSchema>;
const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });
const mesDe = (data: string) => `${data.slice(0, 7)}-01`;

const COLS = `t.id, t.empresa_id AS "empresaId", t.fornecedor_id AS "fornecedorId", coalesce(f.nome, t.beneficiario) AS favorecido, t.descricao, t.plano_conta_id AS "planoContaId",
  pc.codigo || ' ' || pc.nome AS "planoConta", to_char(t.competencia, 'YYYY-MM') AS competencia, t.vencimento::text AS vencimento, t.valor_centavos AS "valorCentavos", t.pago_centavos AS "pagoCentavos",
  t.status, t.origem, t.numero_documento AS "numeroDocumento", t.observacao, t.anexo_id AS "anexoId", t.motivo_rejeicao AS "motivoRejeicao", t.criado_por AS "criadoPorId", cu.nome AS "criadoPor",
  t.aprovado_por AS "aprovadoPorId", au.nome AS "aprovadoPor", t.aprovado_em AS "aprovadoEm", t.motivo_cancelamento AS "motivoCancelamento", t.recorrencia_id AS "recorrenciaId", t.rateio_id AS "rateioId", t.criado_em AS "criadoEm"`;
const FROM = `FROM titulo_pagar t LEFT JOIN fornecedor f ON f.id = t.fornecedor_id LEFT JOIN plano_conta pc ON pc.id = t.plano_conta_id LEFT JOIN usuario cu ON cu.id = t.criado_por LEFT JOIN usuario au ON au.id = t.aprovado_por`;

@Injectable()
export class PagarService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  private async config(c: PoolClient, empresaId: string) {
    const r = (await c.query('SELECT aprovacao_pagar_obrigatoria AS obrig, financeiro_aprova_pagar AS fin FROM empresa_config WHERE empresa_id = $1', [empresaId])).rows[0];
    return { aprovacaoObrigatoria: r?.obrig ?? true, financeiroAprova: r?.fin ?? false };
  }

  private async lerTitulo(c: PoolClient, id: string, travar = false) {
    const t = (await c.query(`SELECT ${COLS} ${FROM} WHERE t.id = $1 ${travar ? 'FOR UPDATE OF t' : ''}`, [id])).rows[0];
    if (!t) throw new NotFoundException('Conta a pagar não encontrada.');
    return t as Record<string, unknown> & { id: string; empresaId: string; status: string; valorCentavos: number; pagoCentavos: number; criadoPorId: string | null; vencimento: string; descricao: string; planoContaId: string | null; origem: string };
  }

  /** Pode aprovar quem tem a permissão (Gerente, Administrativo) ou o Financeiro, se a loja liberou. Nunca quem criou. */
  private async exigirAprovador(c: PoolClient, a: Acesso, empresaId: string, criadoPor: string | null) {
    const perfil = perfilEm(a, empresaId);
    if (!perfil) throw new ForbiddenException('Você não tem permissão para esta ação.');
    if (!temPermissao(perfil, 'pagar.aprovar')) {
      if (perfil !== 'FINANCEIRO' || !(await this.config(c, empresaId)).financeiroAprova) throw new ForbiddenException('Você não tem permissão para aprovar contas a pagar.');
    }
    if (criadoPor && criadoPor === a.usuarioId) throw new ForbiddenException('Quem criou a conta não pode aprová-la. Peça a outra pessoa.');
  }

  private async validarVinculos(c: PoolClient, empresaId: string, d: { fornecedorId?: string | null; planoContaId?: string | null; anexoId?: string | null }) {
    if (d.fornecedorId && !(await c.query(`SELECT 1 FROM fornecedor WHERE id = $1 AND status = 'ATIVO'`, [d.fornecedorId])).rows[0]) throw erroCampo('fornecedorId', 'Escolha um fornecedor ativo.');
    if (d.planoContaId) {
      const pc = (await c.query('SELECT aceita_lancamento AS ok, status FROM plano_conta WHERE id = $1', [d.planoContaId])).rows[0];
      if (!pc || pc.status !== 'ATIVO' || !pc.ok) throw erroCampo('planoContaId', 'Escolha uma conta do plano que aceite lançamento.');
    }
    if (d.anexoId && !(await c.query('SELECT 1 FROM anexo WHERE id = $1 AND empresa_id = $2', [d.anexoId, empresaId])).rows[0]) throw erroCampo('anexoId', 'Anexo não encontrado nesta loja.');
  }

  private async inserir(c: PoolClient, a: Acesso, empresaId: string, d: Titulo & { origem?: string; origemId?: string; recorrenciaId?: string; rateioId?: string; status?: string; criadoPor?: string | null }) {
    const cfg = await this.config(c, empresaId);
    const status = d.status ?? (d.rascunho ? 'RASCUNHO' : cfg.aprovacaoObrigatoria ? 'PENDENTE' : 'APROVADO');
    const r = await c.query(
      `INSERT INTO titulo_pagar (grupo_id, empresa_id, fornecedor_id, beneficiario, descricao, plano_conta_id, competencia, vencimento, valor_centavos, status, origem, origem_id, recorrencia_id, rateio_id, numero_documento, observacao, anexo_id, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [a.grupoId, empresaId, d.fornecedorId ?? null, d.beneficiario ?? null, d.descricao, d.planoContaId ?? null, d.competencia ? `${d.competencia}-01` : mesDe(d.vencimento), d.vencimento, d.valorCentavos, status,
       d.origem ?? 'MANUAL', d.origemId ?? null, d.recorrenciaId ?? null, d.rateioId ?? null, d.numeroDocumento ?? null, d.observacao ?? null, d.anexoId ?? null, d.criadoPor === undefined ? a.usuarioId : d.criadoPor]);
    return r.rows[0].id as string;
  }

  async criar(a: Acesso, d: Titulo) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.criar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      await this.validarVinculos(c, empresaId, d);
      const id = await this.inserir(c, a, empresaId, d);
      const t = await this.lerTitulo(c, id);
      await auditar(c, a, { acao: 'pagar.criado', entidade: 'titulo_pagar', entidadeId: id, empresaId, depois: { descricao: t.descricao, favorecido: t.favorecido, vencimento: t.vencimento, valorCentavos: t.valorCentavos, status: t.status } });
      return t;
    });
  }

  async editar(a: Acesso, id: string, d: z.output<typeof editarTituloPagarSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id, true);
      exigir(a, 'pagar.criar', t.empresaId);
      if (['PAGO', 'CANCELADO'].includes(t.status)) throw new ConflictException('Esta conta já foi paga ou cancelada e não pode ser editada.');
      if (t.pagoCentavos > 0) throw new ConflictException('Esta conta já recebeu pagamento. Estorne os pagamentos antes de editar.');
      if (t.origem !== 'MANUAL' && t.origem !== 'RECORRENCIA' && (d.valorCentavos !== undefined)) throw new ConflictException('O valor desta conta vem de uma apuração e não pode ser alterado aqui.');
      await this.validarVinculos(c, t.empresaId, d);
      const set: string[] = []; const v: unknown[] = [id];
      const col = (nome: string, valor: unknown) => { v.push(valor); set.push(`${nome} = $${v.length}`); };
      if (d.fornecedorId !== undefined) col('fornecedor_id', d.fornecedorId);
      if (d.beneficiario !== undefined) col('beneficiario', d.beneficiario);
      if (d.descricao !== undefined) col('descricao', d.descricao);
      if (d.planoContaId !== undefined) col('plano_conta_id', d.planoContaId);
      if (d.competencia !== undefined) col('competencia', `${d.competencia}-01`);
      if (d.vencimento !== undefined) col('vencimento', d.vencimento);
      if (d.valorCentavos !== undefined) col('valor_centavos', d.valorCentavos);
      if (d.numeroDocumento !== undefined) col('numero_documento', d.numeroDocumento);
      if (d.observacao !== undefined) col('observacao', d.observacao);
      if (d.anexoId !== undefined) col('anexo_id', d.anexoId);
      // mexeu no que foi aprovado: volta para nova aprovação
      const mexeuNoAprovado = t.status === 'APROVADO' && (d.valorCentavos !== undefined || d.vencimento !== undefined || d.fornecedorId !== undefined || d.beneficiario !== undefined);
      if (mexeuNoAprovado && (await this.config(c, t.empresaId)).aprovacaoObrigatoria) { set.push(`status = 'PENDENTE'`, 'aprovado_por = NULL', 'aprovado_em = NULL'); }
      if (set.length === 0) return t;
      await c.query(`UPDATE titulo_pagar SET ${set.join(', ')} WHERE id = $1`, v);
      const depois = await this.lerTitulo(c, id);
      await auditar(c, a, { acao: 'pagar.editado', entidade: 'titulo_pagar', entidadeId: id, empresaId: t.empresaId,
        antes: { descricao: t.descricao, vencimento: t.vencimento, valorCentavos: t.valorCentavos, status: t.status }, depois: { descricao: depois.descricao, vencimento: depois.vencimento, valorCentavos: depois.valorCentavos, status: depois.status } });
      return depois;
    });
  }

  async enviar(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id, true);
      exigir(a, 'pagar.criar', t.empresaId);
      if (t.status !== 'RASCUNHO') throw new ConflictException('Só rascunho vai para aprovação.');
      const status = (await this.config(c, t.empresaId)).aprovacaoObrigatoria ? 'PENDENTE' : 'APROVADO';
      await c.query(`UPDATE titulo_pagar SET status = $2, motivo_rejeicao = NULL WHERE id = $1`, [id, status]);
      await auditar(c, a, { acao: 'pagar.enviado', entidade: 'titulo_pagar', entidadeId: id, empresaId: t.empresaId, depois: { status } });
      return this.lerTitulo(c, id);
    });
  }

  async aprovar(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id, true);
      await this.exigirAprovador(c, a, t.empresaId, t.criadoPorId);
      if (t.status !== 'PENDENTE') throw new ConflictException('Esta conta não está aguardando aprovação.');
      await c.query(`UPDATE titulo_pagar SET status = 'APROVADO', aprovado_por = $2, aprovado_em = now() WHERE id = $1`, [id, a.usuarioId]);
      await auditar(c, a, { acao: 'pagar.aprovado', entidade: 'titulo_pagar', entidadeId: id, empresaId: t.empresaId, depois: { valorCentavos: t.valorCentavos, favorecido: t.favorecido, vencimento: t.vencimento } });
      return this.lerTitulo(c, id);
    });
  }

  async rejeitar(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id, true);
      await this.exigirAprovador(c, a, t.empresaId, t.criadoPorId);
      if (t.status !== 'PENDENTE') throw new ConflictException('Esta conta não está aguardando aprovação.');
      await c.query(`UPDATE titulo_pagar SET status = 'RASCUNHO', motivo_rejeicao = $2 WHERE id = $1`, [id, motivo]);
      await auditar(c, a, { acao: 'pagar.rejeitado', entidade: 'titulo_pagar', entidadeId: id, empresaId: t.empresaId, motivo });
      return this.lerTitulo(c, id);
    });
  }

  async cancelar(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id, true);
      const perfil = perfilEm(a, t.empresaId);
      if (!perfil) throw new ForbiddenException('Você não tem permissão para esta ação.');
      if (!temPermissao(perfil, 'pagar.cancelar')) {
        exigir(a, 'pagar.cancelar_rascunho', t.empresaId);
        if (t.status !== 'RASCUNHO') throw new ForbiddenException('O Financeiro só cancela rascunhos. Peça ao gerente.');
      }
      if (t.status === 'CANCELADO') throw new ConflictException('Esta conta já está cancelada.');
      if (t.pagoCentavos > 0 || t.status === 'PAGO' || t.status === 'PARCIAL') throw new ConflictException('Esta conta já recebeu pagamento. Estorne os pagamentos antes de cancelar.');
      await c.query(`UPDATE titulo_pagar SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $2, motivo_cancelamento = $3 WHERE id = $1`, [id, a.usuarioId, motivo]);
      await c.query('UPDATE laudo_custo SET titulo_pagar_id = NULL WHERE titulo_pagar_id = $1', [id]); // os custos voltam para a próxima apuração
      await auditar(c, a, { acao: 'pagar.cancelado', entidade: 'titulo_pagar', entidadeId: id, empresaId: t.empresaId, antes: { status: t.status }, motivo });
      return this.lerTitulo(c, id);
    });
  }

  private async recalcular(c: PoolClient, id: string) {
    return (await c.query(
      `UPDATE titulo_pagar t SET pago_centavos = p.pago,
              status = CASE WHEN t.status = 'CANCELADO' THEN 'CANCELADO'::status_pagar WHEN p.pago = 0 THEN 'APROVADO'::status_pagar WHEN p.pago >= t.valor_centavos THEN 'PAGO'::status_pagar ELSE 'PARCIAL'::status_pagar END
         FROM (SELECT coalesce(sum(principal_centavos), 0)::int AS pago FROM pagamento_pagar WHERE titulo_id = $1) p WHERE t.id = $1 RETURNING t.status, t.pago_centavos AS "pagoCentavos"`, [id])).rows[0] as { status: string; pagoCentavos: number };
  }

  async pagar(a: Acesso, id: string, d: z.output<typeof pagamentoPagarSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id, true);
      exigir(a, 'pagar.pagar', t.empresaId);
      if (t.status === 'PAGO') throw new ConflictException('Esta conta já está paga.');
      if (t.status === 'CANCELADO') throw new ConflictException('Esta conta está cancelada.');
      if (t.status === 'RASCUNHO') throw new ConflictException('Esta conta ainda é um rascunho. Envie para aprovação primeiro.');
      if (t.status === 'PENDENTE') throw new ConflictException('Esta conta está aguardando aprovação.');
      const hoje = hojeSP(); const data = d.data ?? hoje;
      if (data > hoje) throw erroCampo('data', 'A data do pagamento não pode ser futura.');
      const saldo = t.valorCentavos - t.pagoCentavos;
      const principal = d.principalCentavos ?? saldo;
      if (principal > saldo) throw erroCampo('principalCentavos', `O valor passa do saldo da conta (${formatarBRL(saldo)}).`);
      const juros = d.jurosCentavos ?? 0; const multa = d.multaCentavos ?? 0; const desconto = d.descontoCentavos ?? 0;
      if (desconto > principal + juros + multa) throw erroCampo('descontoCentavos', 'O desconto não pode passar do valor pago.');
      const total = principal + juros + multa - desconto;
      if (total <= 0) throw erroCampo('principalCentavos', 'O valor pago precisa ser maior que zero.');
      if ((juros || multa || desconto) && !d.motivo) throw erroCampo('motivo', 'Explique juros, multa ou desconto no pagamento.');
      const conta = (await c.query(`SELECT nome, tipo FROM conta_financeira WHERE id = $1 AND empresa_id = $2`, [d.contaId, t.empresaId])).rows[0];
      if (!conta) throw erroCampo('contaId', 'Conta não encontrada nesta loja.');
      if (conta.tipo === 'CAIXA') {
        const s = await saldoDaConta(c, d.contaId, data);
        if (s < total) throw new ConflictException(`O caixa "${conta.nome}" tem ${formatarBRL(s)} nesta data: não dá para pagar ${formatarBRL(total)}.`);
      }
      if (d.comprovanteId && !(await c.query('SELECT 1 FROM anexo WHERE id = $1 AND empresa_id = $2', [d.comprovanteId, t.empresaId])).rows[0]) throw erroCampo('comprovanteId', 'Comprovante não encontrado nesta loja.');
      const lanc = await registrarLancamento(c, a, { empresaId: t.empresaId, contaId: d.contaId, data, valorCentavos: -total, origem: 'PAGAMENTO_PAGAR', planoContaId: t.planoContaId, descricao: `Pagamento: ${t.descricao} · ${t.favorecido}` });
      const pg = (await c.query(
        `INSERT INTO pagamento_pagar (grupo_id, empresa_id, titulo_id, data, principal_centavos, juros_centavos, multa_centavos, desconto_centavos, conta_id, lancamento_id, comprovante_id, motivo, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, pago_total_centavos AS "pagoTotalCentavos"`,
        [a.grupoId, t.empresaId, id, data, principal, juros, multa, desconto, d.contaId, lanc, d.comprovanteId ?? null, d.motivo ?? null, a.usuarioId])).rows[0];
      const novo = await this.recalcular(c, id);
      await auditar(c, a, { acao: 'pagar.pagamento', entidade: 'titulo_pagar', entidadeId: id, empresaId: t.empresaId, depois: { pagamento: pg.id, totalCentavos: total, principalCentavos: principal, status: novo.status }, motivo: d.motivo });
      return { pagamentoId: pg.id, pagoTotalCentavos: pg.pagoTotalCentavos, status: novo.status };
    });
  }

  async estornarPagamento(a: Acesso, pagamentoId: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const p = (await c.query(
        `SELECT id, empresa_id AS "empresaId", titulo_id AS "tituloId", data::text AS data, principal_centavos AS principal, juros_centavos AS juros, multa_centavos AS multa, desconto_centavos AS desconto,
                conta_id AS "contaId", lancamento_id AS "lancamentoId", estorno_de AS "estornoDe" FROM pagamento_pagar WHERE id = $1`, [pagamentoId])).rows[0];
      if (!p) throw new NotFoundException('Pagamento não encontrado.');
      await c.query('SELECT 1 FROM titulo_pagar WHERE id = $1 FOR UPDATE', [p.tituloId]);
      if (p.estornoDe) throw new ConflictException('Isto já é um estorno.');
      if ((await c.query('SELECT 1 FROM pagamento_pagar WHERE estorno_de = $1', [pagamentoId])).rows[0]) throw new ConflictException('Este pagamento já foi estornado.');
      const perfil = perfilEm(a, p.empresaId);
      if (!perfil) throw new ForbiddenException('Você não tem permissão para esta ação.');
      if (!temPermissao(perfil, 'pagar.estornar')) {
        exigir(a, 'pagar.estornar_periodo_aberto', p.empresaId);
        const fechadoAte = await ultimoDiaFechado(c, p.contaId);
        const mesFechado = (await c.query('SELECT periodo_fechado($1, $2) AS f', [p.empresaId, p.data])).rows[0].f;
        if (mesFechado || (fechadoAte && fechadoAte >= p.data)) throw new ForbiddenException('Este pagamento é de um período já fechado. Peça ao gerente para estornar.');
      }
      const hoje = hojeSP();
      const lanc = await estornarLancamento(c, a, p.lancamentoId, hoje, motivo);
      const est = (await c.query(
        `INSERT INTO pagamento_pagar (grupo_id, empresa_id, titulo_id, data, principal_centavos, juros_centavos, multa_centavos, desconto_centavos, conta_id, lancamento_id, estorno_de, motivo, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [a.grupoId, p.empresaId, p.tituloId, hoje, -p.principal, -p.juros, -p.multa, -p.desconto, p.contaId, lanc, pagamentoId, motivo, a.usuarioId])).rows[0];
      const novo = await this.recalcular(c, p.tituloId);
      await auditar(c, a, { acao: 'pagar.pagamento_estornado', entidade: 'titulo_pagar', entidadeId: p.tituloId, empresaId: p.empresaId, depois: { pagamentoOriginal: pagamentoId, estorno: est.id, status: novo.status }, motivo });
      return { id: est.id, status: novo.status };
    });
  }

  // ---- consultas ----
  async listar(a: Acesso, f: Filtro) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      await this.gerarRecorrencias(c, a, empresaId);
      const hoje = hojeSP();
      const onde = ['t.empresa_id = $1']; const p: unknown[] = [empresaId];
      const add = (sql: string, v: unknown) => { p.push(v); onde.push(sql.replace('?', `$${p.length}`)); };
      if (f.situacao === 'abertos') onde.push(`t.status IN ('APROVADO','PARCIAL')`);
      if (f.situacao === 'vencidos') { p.push(hoje); onde.push(`t.status IN ('APROVADO','PARCIAL') AND t.vencimento < $${p.length}`); }
      if (f.situacao === 'pendentes') onde.push(`t.status = 'PENDENTE'`);
      if (f.situacao === 'rascunhos') onde.push(`t.status = 'RASCUNHO'`);
      if (f.situacao === 'pagos') onde.push(`t.status = 'PAGO'`);
      if (f.situacao === 'cancelados') onde.push(`t.status = 'CANCELADO'`);
      if (f.fornecedorId) add('t.fornecedor_id = ?', f.fornecedorId);
      if (f.origem) add('t.origem = ?::origem_pagar', f.origem);
      if (f.vencDe) add('t.vencimento >= ?', f.vencDe);
      if (f.vencAte) add('t.vencimento <= ?', f.vencAte);
      const tot = (await c.query(`SELECT count(*)::int AS n, coalesce(sum(t.valor_centavos - t.pago_centavos) FILTER (WHERE t.status IN ('APROVADO','PARCIAL','PENDENTE')), 0)::bigint AS saldo FROM titulo_pagar t WHERE ${onde.join(' AND ')}`, p)).rows[0];
      p.push(f.limite, f.pagina * f.limite);
      const rows = (await c.query(`SELECT ${COLS} ${FROM} WHERE ${onde.join(' AND ')} ORDER BY t.vencimento, t.criado_em LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
      return { itens: rows.map((r) => ({ ...r, saldoCentavos: r.valorCentavos - r.pagoCentavos, vencido: (r.status === 'APROVADO' || r.status === 'PARCIAL') && r.vencimento < hoje })), total: tot.n, saldoCentavos: tot.saldo, hoje };
    });
  }

  async resumo(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const r = (await c.query(
        `SELECT coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('APROVADO','PARCIAL')), 0)::bigint AS "aPagarCentavos",
                coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('APROVADO','PARCIAL') AND vencimento < $2), 0)::bigint AS "vencidoCentavos",
                coalesce(sum(valor_centavos - pago_centavos) FILTER (WHERE status IN ('APROVADO','PARCIAL') AND vencimento BETWEEN $2 AND $2::date + 7), 0)::bigint AS "vence7DiasCentavos",
                count(*) FILTER (WHERE status = 'PENDENTE')::int AS "pendentesAprovacao", count(*) FILTER (WHERE status = 'RASCUNHO')::int AS rascunhos
           FROM titulo_pagar WHERE empresa_id = $1`, [empresaId, hoje])).rows[0];
      const mes = (await c.query(`SELECT coalesce(sum(pago_total_centavos), 0)::bigint AS v FROM pagamento_pagar WHERE empresa_id = $1 AND data >= date_trunc('month', $2::date)`, [empresaId, hoje])).rows[0].v;
      return { ...r, pagoNoMesCentavos: mes };
    });
  }

  async detalhe(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const t = await this.lerTitulo(c, id);
      exigir(a, 'pagar.ver', t.empresaId);
      const pagamentos = (await c.query(
        `SELECT p.id, p.data::text AS data, p.principal_centavos AS "principalCentavos", p.juros_centavos AS "jurosCentavos", p.multa_centavos AS "multaCentavos", p.desconto_centavos AS "descontoCentavos",
                p.pago_total_centavos AS "pagoTotalCentavos", cf.nome AS conta, p.comprovante_id AS "comprovanteId", p.estorno_de AS "estornoDe", p.motivo, u.nome AS "criadoPor",
                EXISTS (SELECT 1 FROM pagamento_pagar e WHERE e.estorno_de = p.id) AS estornado
           FROM pagamento_pagar p JOIN conta_financeira cf ON cf.id = p.conta_id LEFT JOIN usuario u ON u.id = p.criado_por WHERE p.titulo_id = $1 ORDER BY p.criado_em`, [id])).rows;
      const anexo = t.anexoId ? (await c.query('SELECT id, nome, mime, tamanho_bytes AS tamanho FROM anexo WHERE id = $1', [t.anexoId])).rows[0] : null;
      const custos = t.origem === 'CUSTO_LAUDO' ? (await c.query(`SELECT count(*)::int AS laudos, min(l.data_laudo)::text AS de, max(l.data_laudo)::text AS ate FROM laudo_custo lc JOIN laudo l ON l.id = lc.laudo_id WHERE lc.titulo_pagar_id = $1`, [id])).rows[0] : null;
      return { ...t, saldoCentavos: t.valorCentavos - t.pagoCentavos, pagamentos, anexo, custos };
    });
  }

  // ---- anexos ----
  async guardarAnexo(a: Acesso, arquivo: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.criar', empresaId);
    const b = arquivo.buffer;
    const mime = b.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : null;
    if (!mime) throw new UnprocessableEntityException({ mensagem: 'Envie um PDF, PNG ou JPG.', campos: { arquivo: 'Formato não aceito. Use PDF, PNG ou JPG.' } });
    if (b.length === 0 || b.length > 5 * 1024 * 1024) throw new UnprocessableEntityException({ mensagem: 'O arquivo precisa ter até 5 MB.', campos: { arquivo: 'Arquivo grande demais.' } });
    return this.db.tenant(contextoDb(a), async (c) => {
      const nome = arquivo.originalname.replace(/[^\w.\- ()]/g, '_').slice(-120) || 'anexo';
      const r = (await c.query(`INSERT INTO anexo (grupo_id, empresa_id, nome, mime, tamanho_bytes, sha256, conteudo, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nome, mime, tamanho_bytes AS tamanho`,
        [a.grupoId, empresaId, nome, mime, b.length, createHash('sha256').update(b).digest('hex'), b, a.usuarioId])).rows[0];
      await auditar(c, a, { acao: 'anexo.enviado', entidade: 'anexo', entidadeId: r.id, empresaId, depois: { nome, mime, tamanho: b.length } });
      return r;
    });
  }

  async lerAnexo(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query('SELECT empresa_id AS "empresaId", nome, mime, conteudo FROM anexo WHERE id = $1', [id])).rows[0];
      if (!r) throw new NotFoundException('Anexo não encontrado.');
      exigir(a, 'pagar.ver', r.empresaId);
      await auditar(c, a, { acao: 'anexo.baixado', entidade: 'anexo', entidadeId: id, empresaId: r.empresaId });
      return r as { nome: string; mime: string; conteudo: Buffer };
    });
  }

  // ---- recorrência ----
  async criarRecorrencia(a: Acesso, d: z.output<typeof recorrenciaSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.recorrencia', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      await this.validarVinculos(c, empresaId, d);
      const id = (await c.query(
        `INSERT INTO recorrencia_pagar (grupo_id, empresa_id, fornecedor_id, descricao, plano_conta_id, valor_centavos, frequencia, dia, inicio, fim, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [a.grupoId, empresaId, d.fornecedorId ?? null, d.descricao, d.planoContaId ?? null, d.valorCentavos, d.frequencia, d.dia, d.inicio, d.fim ?? null, a.usuarioId])).rows[0].id;
      await auditar(c, a, { acao: 'pagar.recorrencia_criada', entidade: 'recorrencia_pagar', entidadeId: id, empresaId, depois: d });
      const gerados = await this.gerarRecorrencias(c, a, empresaId);
      return { id, titulosGerados: gerados };
    });
  }

  async listarRecorrencias(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT r.id, r.descricao, f.nome AS fornecedor, r.valor_centavos AS "valorCentavos", r.frequencia, r.dia, r.inicio::text AS inicio, r.fim::text AS fim, r.gerada_ate::text AS "geradaAte", r.ativa
         FROM recorrencia_pagar r LEFT JOIN fornecedor f ON f.id = r.fornecedor_id WHERE r.empresa_id = $1 ORDER BY r.ativa DESC, r.descricao`, [empresaId])).rows);
  }

  async alternarRecorrencia(a: Acesso, id: string, ativa: boolean) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query('UPDATE recorrencia_pagar SET ativa = $2 WHERE id = $1 RETURNING empresa_id AS "empresaId", descricao', [id, ativa])).rows[0];
      if (!r) throw new NotFoundException('Recorrência não encontrada.');
      exigir(a, 'pagar.recorrencia', r.empresaId);
      await auditar(c, a, { acao: ativa ? 'pagar.recorrencia_reativada' : 'pagar.recorrencia_pausada', entidade: 'recorrencia_pagar', entidadeId: id, empresaId: r.empresaId, depois: { descricao: r.descricao } });
      return { ok: true };
    });
  }

  /** Cria as contas das recorrências até 35 dias à frente. Pode rodar quantas vezes quiser: o banco impede repetir o mesmo vencimento. */
  private async gerarRecorrencias(c: PoolClient, a: Acesso, empresaId: string): Promise<number> {
    const hoje = hojeSP();
    const limite = new Date(Date.parse(hoje) + 35 * 86_400_000).toISOString().slice(0, 10);
    const minimo = new Date(Date.parse(hoje) - 31 * 86_400_000).toISOString().slice(0, 10);
    const regras = (await c.query(`SELECT id, fornecedor_id AS "fornecedorId", descricao, plano_conta_id AS "planoContaId", valor_centavos AS "valorCentavos", frequencia, dia, inicio::text AS inicio, fim::text AS fim, criado_por AS "criadoPor"
      FROM recorrencia_pagar WHERE empresa_id = $1 AND ativa AND (gerada_ate IS NULL OR gerada_ate < $2::date)`, [empresaId, limite])).rows;
    let n = 0;
    for (const r of regras) {
      const ate = r.fim && r.fim < limite ? r.fim : limite;
      let ultima: string | null = null;
      for (const venc of datasDaRecorrencia(r.frequencia, r.dia, r.inicio, ate)) {
        if (venc < minimo) continue; // não cria de uma vez meses antigos: só do último mês em diante
        const cfg = await this.config(c, empresaId);
        const ins = await c.query(
          `INSERT INTO titulo_pagar (grupo_id, empresa_id, fornecedor_id, descricao, plano_conta_id, competencia, vencimento, valor_centavos, status, origem, recorrencia_id, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RECORRENCIA',$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
          [a.grupoId, empresaId, r.fornecedorId, r.descricao, r.planoContaId, mesDe(venc), venc, r.valorCentavos, cfg.aprovacaoObrigatoria ? 'PENDENTE' : 'APROVADO', r.id, r.criadoPor]);
        if (ins.rowCount) n++;
        ultima = venc;
      }
      await c.query('UPDATE recorrencia_pagar SET gerada_ate = $2 WHERE id = $1', [r.id, ultima ?? limite]);
    }
    return n;
  }

  // ---- rateio entre lojas (só o Administrativo) ----
  async ratear(a: Acesso, d: z.output<typeof rateioSchema>) {
    if (!a.rede) throw new ForbiddenException('Só o Administrativo divide uma despesa entre lojas.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const lojas = (await c.query(`SELECT id FROM empresa WHERE id = ANY($1::uuid[]) AND status = 'ATIVO'`, [d.itens.map((i) => i.empresaId)])).rows;
      if (lojas.length !== d.itens.length) throw erroCampo('itens', 'Alguma loja não foi encontrada ou está inativa.');
      await this.validarVinculos(c, d.itens[0]!.empresaId, d);
      const partes = ratear(d.valorTotalCentavos, d.itens.map((i) => i.pesoBp));
      const rateioId = crypto.randomUUID();
      const ids: string[] = [];
      for (const [i, it] of d.itens.entries()) {
        const id = await this.inserir(c, a, it.empresaId, { ...d, valorCentavos: partes[i]!, descricao: `${d.descricao} (rateio ${it.pesoBp / 100}%)`, origem: 'RATEIO', rateioId });
        ids.push(id);
      }
      await auditar(c, a, { acao: 'pagar.rateio', entidade: 'titulo_pagar', entidadeId: ids[0], empresaId: d.itens[0]!.empresaId, depois: { rateioId, totalCentavos: d.valorTotalCentavos, lojas: d.itens.map((x, i) => ({ empresaId: x.empresaId, pesoBp: x.pesoBp, valorCentavos: partes[i] })) } });
      return { rateioId, titulos: ids.length, partesCentavos: partes };
    });
  }

  // ---- custos de laudo que geram conta a pagar ----
  async custosAApurar(a: Acesso, de: string, ate: string) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.criar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT lc.fornecedor_id AS "fornecedorId", f.nome AS fornecedor, count(*)::int AS custos, count(DISTINCT lc.laudo_id)::int AS laudos, sum(lc.valor_centavos)::bigint AS "totalCentavos"
         FROM laudo_custo lc JOIN laudo l ON l.id = lc.laudo_id JOIN fornecedor f ON f.id = lc.fornecedor_id
        WHERE lc.empresa_id = $1 AND lc.gera_conta_pagar AND lc.ativo AND lc.titulo_pagar_id IS NULL AND l.status = 'ATIVO' AND l.data_laudo BETWEEN $2 AND $3 AND lc.valor_centavos > 0
        GROUP BY lc.fornecedor_id, f.nome ORDER BY f.nome`, [empresaId, de, ate])).rows);
  }

  async apurarCustos(a: Acesso, d: z.output<typeof apurarCustosSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'pagar.criar', empresaId);
    if (d.ate > hojeSP()) throw erroCampo('ate', 'O período ainda não terminou.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const linhas = (await c.query(
        `SELECT lc.id, lc.laudo_id AS "laudoId", lc.fornecedor_id AS "fornecedorId", f.nome AS fornecedor, f.conta_padrao_id AS "planoContaId", lc.valor_centavos AS valor
           FROM laudo_custo lc JOIN laudo l ON l.id = lc.laudo_id JOIN fornecedor f ON f.id = lc.fornecedor_id
          WHERE lc.empresa_id = $1 AND lc.gera_conta_pagar AND lc.ativo AND lc.titulo_pagar_id IS NULL AND l.status = 'ATIVO' AND l.data_laudo BETWEEN $2 AND $3 AND lc.valor_centavos > 0
          ORDER BY f.nome, lc.id FOR UPDATE OF lc`, [empresaId, d.de, d.ate])).rows as { id: string; laudoId: string; fornecedorId: string; fornecedor: string; planoContaId: string | null; valor: number }[];
      const porFornecedor = new Map<string, { fornecedorId: string; fornecedor: string; planoContaId: string | null; total: number; ids: string[]; laudos: Set<string> }>();
      for (const l of linhas) {
        const g = porFornecedor.get(l.fornecedorId) ?? { fornecedorId: l.fornecedorId, fornecedor: l.fornecedor, planoContaId: l.planoContaId, total: 0, ids: [], laudos: new Set<string>() };
        g.total += l.valor; g.ids.push(l.id); g.laudos.add(l.laudoId); porFornecedor.set(l.fornecedorId, g);
      }
      const grupos = [...porFornecedor.values()].map((g) => ({ ...g, laudos: g.laudos.size }));
      const vencimento = d.vencimento ?? hojeSP();
      const criados: { id: string; fornecedor: string; totalCentavos: number; laudos: number }[] = [];
      for (const g of grupos) {
        const periodo = `${d.de.split('-').reverse().join('/')} a ${d.ate.split('-').reverse().join('/')}`;
        const id = await this.inserir(c, a, empresaId, { fornecedorId: g.fornecedorId, planoContaId: g.planoContaId, descricao: `Custos de ${g.laudos} laudos (${periodo})`, competencia: d.ate.slice(0, 7), vencimento, valorCentavos: g.total, origem: 'CUSTO_LAUDO' } as never);
        await c.query('UPDATE laudo_custo SET titulo_pagar_id = $2 WHERE id = ANY($1::uuid[])', [g.ids, id]);
        criados.push({ id, fornecedor: g.fornecedor, totalCentavos: g.total, laudos: g.laudos });
        await auditar(c, a, { acao: 'pagar.custos_apurados', entidade: 'titulo_pagar', entidadeId: id, empresaId, depois: { fornecedor: g.fornecedor, periodo, laudos: g.laudos, totalCentavos: g.total } });
      }
      return { titulos: criados.length, criados };
    });
  }
}
void BadRequestException;
