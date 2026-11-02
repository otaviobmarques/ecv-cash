import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { aplicarBp, formatarBRL, type aliquotaSchema, type apurarRepasseSchema, type editarAliquotaSchema, type editarRegraRepasseSchema, type regraRepasseSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { inserirTituloPagar } from '../pagar/titulo-pagar';
import { impostosDoPeriodo } from './impostos';

const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });
const fimDoMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10);
const maior = (a: string, b: string) => (a > b ? a : b);
const menor = (a: string, b: string) => (a < b ? a : b);

type Regra = { id: string; empresaId: string; fornecedorId: string; fornecedor: string; nome: string; tipo: 'PERCENTUAL' | 'VALOR_FIXO'; percentualBp: number | null; valorCentavos: number | null; base: 'BRUTO' | 'LIQUIDO' | 'RECEBIDO' | null; vencimentoDia: number; planoContaId: string | null; vigenciaIni: string; vigenciaFim: string | null; ativa: boolean };
const COLS_REGRA = `r.id, r.empresa_id AS "empresaId", r.fornecedor_id AS "fornecedorId", f.nome AS fornecedor, r.nome, r.tipo, r.percentual_bp AS "percentualBp", r.valor_centavos AS "valorCentavos", r.base,
  r.vencimento_dia AS "vencimentoDia", r.plano_conta_id AS "planoContaId", r.vigencia_ini::text AS "vigenciaIni", r.vigencia_fim::text AS "vigenciaFim", r.ativa`;

@Injectable()
export class RepassesService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  // ---- regras ----
  async regras(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'repasse.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(`SELECT ${COLS_REGRA} FROM regra_repasse r JOIN fornecedor f ON f.id = r.fornecedor_id WHERE r.empresa_id = $1 ORDER BY r.ativa DESC, r.vigencia_ini DESC`, [empresaId])).rows);
  }

  async criarRegra(a: Acesso, d: z.output<typeof regraRepasseSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'repasse.editar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      if (!(await c.query(`SELECT 1 FROM fornecedor WHERE id = $1 AND status = 'ATIVO'`, [d.fornecedorId])).rows[0]) throw erroCampo('fornecedorId', 'Escolha um fornecedor ativo.');
      const id = (await c.query(
        `INSERT INTO regra_repasse (grupo_id, empresa_id, fornecedor_id, nome, tipo, percentual_bp, valor_centavos, base, vencimento_dia, plano_conta_id, vigencia_ini, vigencia_fim, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [a.grupoId, empresaId, d.fornecedorId, d.nome, d.tipo, d.tipo === 'PERCENTUAL' ? d.percentualBp : null, d.tipo === 'VALOR_FIXO' ? d.valorCentavos : null, d.tipo === 'PERCENTUAL' ? d.base : null, d.vencimentoDia, d.planoContaId ?? null, d.vigenciaIni, d.vigenciaFim ?? null, a.usuarioId])).rows[0].id;
      await auditar(c, a, { acao: 'repasse.regra_criada', entidade: 'regra_repasse', entidadeId: id, empresaId, depois: d });
      return { id };
    });
  }

  async editarRegra(a: Acesso, id: string, d: z.output<typeof editarRegraRepasseSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query('SELECT empresa_id AS "empresaId", ativa, vigencia_ini::text AS ini, vigencia_fim::text AS fim FROM regra_repasse WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) throw new NotFoundException('Regra não encontrada.');
      exigir(a, 'repasse.editar', r.empresaId);
      if (d.vigenciaFim && d.vigenciaFim < r.ini) throw erroCampo('vigenciaFim', 'O fim não pode ser antes do início.');
      await c.query('UPDATE regra_repasse SET ativa = coalesce($2, ativa), vigencia_fim = CASE WHEN $3::boolean THEN $4 ELSE vigencia_fim END WHERE id = $1', [id, d.ativa ?? null, d.vigenciaFim !== undefined, d.vigenciaFim ?? null]);
      await auditar(c, a, { acao: 'repasse.regra_alterada', entidade: 'regra_repasse', entidadeId: id, empresaId: r.empresaId, antes: { ativa: r.ativa, vigenciaFim: r.fim }, depois: d });
      return { ok: true };
    });
  }

  // ---- apuração ----
  /** Base de cálculo do mês, só nos dias em que a regra vale. */
  private async baseDoMes(c: PoolClient, r: Regra, mes: string): Promise<{ base: number; valor: number; de: string; ate: string }> {
    const de = maior(mes, r.vigenciaIni); const ate = menor(fimDoMes(mes.slice(0, 7)), r.vigenciaFim ?? '9999-12-31');
    if (r.tipo === 'VALOR_FIXO') return { base: 0, valor: r.valorCentavos!, de, ate };
    const bruto = Number((await c.query(`SELECT coalesce(sum(valor_cobrado_centavos), 0) AS v FROM laudo WHERE empresa_id = $1 AND status = 'ATIVO' AND data_laudo BETWEEN $2 AND $3`, [r.empresaId, de, ate])).rows[0].v);
    let base = bruto;
    if (r.base === 'LIQUIDO') {
      const custos = Number((await c.query(`SELECT coalesce(sum(lc.valor_centavos), 0) AS v FROM laudo_custo lc JOIN laudo l ON l.id = lc.laudo_id WHERE l.empresa_id = $1 AND l.status = 'ATIVO' AND lc.ativo AND l.data_laudo BETWEEN $2 AND $3`, [r.empresaId, de, ate])).rows[0].v);
      const impostos = (await impostosDoPeriodo(c, r.empresaId, de, ate)).reduce((s, i) => s + i.totalCentavos, 0);
      base = bruto - custos - impostos;
    }
    if (r.base === 'RECEBIDO') base = Number((await c.query(`SELECT coalesce(sum(principal_centavos), 0) AS v FROM baixa_receber WHERE empresa_id = $1 AND data BETWEEN $2 AND $3`, [r.empresaId, de, ate])).rows[0].v);
    return { base, valor: base > 0 ? aplicarBp(base, r.percentualBp!) : 0, de, ate };
  }

  private async regrasDoMes(c: PoolClient, empresaId: string, mes: string, regraId?: string): Promise<Regra[]> {
    return (await c.query(
      `SELECT ${COLS_REGRA} FROM regra_repasse r JOIN fornecedor f ON f.id = r.fornecedor_id
        WHERE r.empresa_id = $1 AND r.ativa AND r.vigencia_ini <= $3 AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= $2) AND ($4::uuid IS NULL OR r.id = $4) ORDER BY r.nome`,
      [empresaId, mes, fimDoMes(mes.slice(0, 7)), regraId ?? null])).rows;
  }

  private validarMes(mes: string): string {
    const primeiro = `${mes}-01`;
    if (fimDoMes(mes) >= hojeSP()) throw erroCampo('mes', 'O mês ainda não terminou. Só dá para apurar meses encerrados.');
    return primeiro;
  }

  async previa(a: Acesso, mes: string) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'repasse.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const regras = await this.regrasDoMes(c, empresaId, `${mes}-01`);
      const feitos = new Map((await c.query(`SELECT regra_id AS "regraId", id, valor_centavos AS valor FROM repasse_apuracao WHERE empresa_id = $1 AND mes = $2 AND status = 'APURADO'`, [empresaId, `${mes}-01`])).rows.map((x) => [x.regraId as string, x]));
      const out = [];
      for (const r of regras) { const b = await this.baseDoMes(c, r, `${mes}-01`); out.push({ regraId: r.id, nome: r.nome, fornecedor: r.fornecedor, tipo: r.tipo, baseCentavos: b.base, valorCentavos: b.valor, baseTipo: r.base, apurada: feitos.has(r.id), apuracaoId: feitos.get(r.id)?.id ?? null }); }
      return out;
    });
  }

  async apurar(a: Acesso, d: z.output<typeof apurarRepasseSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'repasse.apurar', empresaId);
    const mes = this.validarMes(d.mes);
    return this.db.tenant(contextoDb(a), async (c) => {
      const regras = await this.regrasDoMes(c, empresaId, mes, d.regraId);
      const criados: { id: string; nome: string; fornecedor: string; valorCentavos: number; tituloId: string }[] = [];
      const pulados: { nome: string; motivo: string }[] = [];
      for (const r of regras) {
        if ((await c.query(`SELECT 1 FROM repasse_apuracao WHERE regra_id = $1 AND mes = $2 AND status = 'APURADO'`, [r.id, mes])).rows[0]) { pulados.push({ nome: r.nome, motivo: 'Já apurado neste mês.' }); continue; }
        const b = await this.baseDoMes(c, r, mes);
        if (b.valor <= 0) { pulados.push({ nome: r.nome, motivo: 'Valor zerado neste mês (sem base de cálculo).' }); continue; }
        const proximo = new Date(Date.UTC(+d.mes.slice(0, 4), +d.mes.slice(5, 7), 1));
        const ultimo = new Date(Date.UTC(proximo.getUTCFullYear(), proximo.getUTCMonth() + 1, 0)).getUTCDate();
        const venc = new Date(Date.UTC(proximo.getUTCFullYear(), proximo.getUTCMonth(), Math.min(r.vencimentoDia, ultimo))).toISOString().slice(0, 10);
        const titulo = await inserirTituloPagar(c, a, empresaId, { fornecedorId: r.fornecedorId, planoContaId: r.planoContaId, descricao: `${r.nome} de ${d.mes.split('-').reverse().join('/')}${r.tipo === 'PERCENTUAL' ? ` (base ${formatarBRL(b.base)})` : ''}`, competencia: d.mes, vencimento: venc, valorCentavos: b.valor, origem: 'ROYALTY' });
        const id = (await c.query(`INSERT INTO repasse_apuracao (grupo_id, empresa_id, regra_id, mes, base_centavos, valor_centavos, titulo_pagar_id, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [a.grupoId, empresaId, r.id, mes, b.base, b.valor, titulo, a.usuarioId])).rows[0].id;
        await c.query('UPDATE titulo_pagar SET origem_id = $2 WHERE id = $1', [titulo, id]);
        await auditar(c, a, { acao: 'repasse.apurado', entidade: 'repasse_apuracao', entidadeId: id, empresaId, depois: { regra: r.nome, mes: d.mes, baseCentavos: b.base, valorCentavos: b.valor, tituloPagarId: titulo } });
        criados.push({ id, nome: r.nome, fornecedor: r.fornecedor, valorCentavos: b.valor, tituloId: titulo });
      }
      return { apuradas: criados.length, criados, pulados };
    });
  }

  async apuracoes(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'repasse.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT p.id, to_char(p.mes, 'YYYY-MM') AS mes, r.nome, f.nome AS fornecedor, p.base_centavos AS "baseCentavos", p.valor_centavos AS "valorCentavos", p.status, p.motivo_cancelamento AS "motivoCancelamento",
              p.titulo_pagar_id AS "tituloPagarId", t.status AS "statusPagar"
         FROM repasse_apuracao p JOIN regra_repasse r ON r.id = p.regra_id JOIN fornecedor f ON f.id = r.fornecedor_id LEFT JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
        WHERE p.empresa_id = $1 ORDER BY p.mes DESC, r.nome LIMIT 120`, [empresaId])).rows);
  }

  async cancelarApuracao(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const p = (await c.query('SELECT id, empresa_id AS "empresaId", status, titulo_pagar_id AS "tituloId" FROM repasse_apuracao WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!p) throw new NotFoundException('Apuração não encontrada.');
      exigir(a, 'repasse.apurar', p.empresaId);
      if (p.status === 'CANCELADO') throw new ConflictException('Esta apuração já foi cancelada.');
      const t = (await c.query('SELECT status, pago_centavos AS pago FROM titulo_pagar WHERE id = $1 FOR UPDATE', [p.tituloId])).rows[0];
      if (t && (t.pago > 0 || t.status === 'PAGO' || t.status === 'PARCIAL')) throw new ConflictException('A conta a pagar desta apuração já recebeu pagamento. Estorne os pagamentos antes de cancelar.');
      if (t && t.status !== 'CANCELADO') await c.query(`UPDATE titulo_pagar SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $2, motivo_cancelamento = $3 WHERE id = $1`, [p.tituloId, a.usuarioId, `Apuração cancelada: ${motivo}`]);
      await c.query(`UPDATE repasse_apuracao SET status = 'CANCELADO', motivo_cancelamento = $2 WHERE id = $1`, [id, motivo]);
      await auditar(c, a, { acao: 'repasse.apuracao_cancelada', entidade: 'repasse_apuracao', entidadeId: id, empresaId: p.empresaId, motivo });
      return { ok: true };
    });
  }

  // ---- alíquotas ----
  async aliquotas(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'aliquota.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT id, nome, descricao, percentual_bp AS "percentualBp", vigencia_ini::text AS "vigenciaIni", vigencia_fim::text AS "vigenciaFim", ativa FROM aliquota_imposto WHERE empresa_id = $1 ORDER BY ativa DESC, nome, vigencia_ini DESC`, [empresaId])).rows);
  }

  async criarAliquota(a: Acesso, d: z.output<typeof aliquotaSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'aliquota.editar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      let id: string;
      try {
        id = (await c.query(`INSERT INTO aliquota_imposto (grupo_id, empresa_id, nome, descricao, percentual_bp, vigencia_ini, vigencia_fim, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [a.grupoId, empresaId, d.nome, d.descricao ?? null, d.percentualBp, d.vigenciaIni, d.vigenciaFim ?? null, a.usuarioId])).rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23P01') throw new ConflictException('Já existe alíquota deste imposto valendo nesse período. Encerre a anterior na véspera e cadastre a nova.');
        throw e;
      }
      await auditar(c, a, { acao: 'aliquota.criada', entidade: 'aliquota_imposto', entidadeId: id, empresaId, depois: d });
      return { id };
    });
  }

  async editarAliquota(a: Acesso, id: string, d: z.output<typeof editarAliquotaSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query('SELECT empresa_id AS "empresaId", ativa, vigencia_ini::text AS ini, vigencia_fim::text AS fim FROM aliquota_imposto WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) throw new NotFoundException('Alíquota não encontrada.');
      exigir(a, 'aliquota.editar', r.empresaId);
      if (d.vigenciaFim && d.vigenciaFim < r.ini) throw erroCampo('vigenciaFim', 'O fim não pode ser antes do início.');
      try { await c.query('UPDATE aliquota_imposto SET ativa = coalesce($2, ativa), vigencia_fim = CASE WHEN $3::boolean THEN $4 ELSE vigencia_fim END WHERE id = $1', [id, d.ativa ?? null, d.vigenciaFim !== undefined, d.vigenciaFim ?? null]); }
      catch (e) { if ((e as { code?: string }).code === '23P01') throw new ConflictException('Já existe outra alíquota deste imposto nesse período.'); throw e; }
      await auditar(c, a, { acao: 'aliquota.alterada', entidade: 'aliquota_imposto', entidadeId: id, empresaId: r.empresaId, antes: { ativa: r.ativa, vigenciaFim: r.fim }, depois: d });
      return { ok: true };
    });
  }
}
