import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { formatarBRL, type apuracaoComissaoSchema, type editarRegraComissaoSchema, type fecharComissaoSchema, type regraComissaoSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { inserirTituloPagar } from '../pagar/titulo-pagar';

const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });
const br = (iso: string) => iso.split('-').reverse().join('/');

@Injectable()
export class ComissoesService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  async regras(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'comissao.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT r.id, r.vistoriador_id AS "vistoriadorId", v.nome AS vistoriador, r.servico_id AS "servicoId", s.nome AS servico, r.tipo, r.percentual_bp AS "percentualBp", r.valor_centavos AS "valorCentavos",
              r.devida_em AS "devidaEm", r.vigencia_ini::text AS "vigenciaIni", r.vigencia_fim::text AS "vigenciaFim", r.ativa
         FROM regra_comissao r LEFT JOIN vistoriador v ON v.id = r.vistoriador_id LEFT JOIN servico s ON s.id = r.servico_id
        WHERE r.empresa_id = $1 ORDER BY r.ativa DESC, r.vigencia_ini DESC, r.criado_em DESC`, [empresaId])).rows);
  }

  async criarRegra(a: Acesso, d: z.output<typeof regraComissaoSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'comissao_regra.editar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      if (d.vistoriadorId && !(await c.query('SELECT 1 FROM vistoriador_empresa WHERE vistoriador_id = $1 AND empresa_id = $2', [d.vistoriadorId, empresaId])).rows[0]) throw erroCampo('vistoriadorId', 'Este vistoriador não atua nesta loja.');
      const id = (await c.query(
        `INSERT INTO regra_comissao (grupo_id, empresa_id, vistoriador_id, servico_id, tipo, percentual_bp, valor_centavos, devida_em, vigencia_ini, vigencia_fim, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [a.grupoId, empresaId, d.vistoriadorId ?? null, d.servicoId ?? null, d.tipo, d.tipo === 'PERCENTUAL' ? d.percentualBp : null, d.tipo === 'VALOR' ? d.valorCentavos : null, d.devidaEm, d.vigenciaIni, d.vigenciaFim ?? null, a.usuarioId])).rows[0].id;
      await auditar(c, a, { acao: 'comissao.regra_criada', entidade: 'regra_comissao', entidadeId: id, empresaId, depois: d });
      return { id };
    });
  }

  async editarRegra(a: Acesso, id: string, d: z.output<typeof editarRegraComissaoSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query('SELECT empresa_id AS "empresaId", ativa, vigencia_ini::text AS ini, vigencia_fim::text AS fim FROM regra_comissao WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) throw new NotFoundException('Regra não encontrada.');
      exigir(a, 'comissao_regra.editar', r.empresaId);
      if (d.vigenciaFim && d.vigenciaFim < r.ini) throw erroCampo('vigenciaFim', 'O fim não pode ser antes do início.');
      await c.query('UPDATE regra_comissao SET ativa = coalesce($2, ativa), vigencia_fim = CASE WHEN $3::boolean THEN $4 ELSE vigencia_fim END WHERE id = $1', [id, d.ativa ?? null, d.vigenciaFim !== undefined, d.vigenciaFim ?? null]);
      await auditar(c, a, { acao: 'comissao.regra_alterada', entidade: 'regra_comissao', entidadeId: id, empresaId: r.empresaId, antes: { ativa: r.ativa, vigenciaFim: r.fim }, depois: d });
      return { ok: true };
    });
  }

  /** Quanto cada vistoriador tem a receber no período: o que já pode fechar e o que aguarda o recebimento do laudo. */
  async apuracao(a: Acesso, d: z.output<typeof apuracaoComissaoSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'comissao.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await this.agrupar(c, empresaId, d.de, d.ate, d.vistoriadorId)).map(({ ids: _ids, ...g }) => g));
  }

  private async agrupar(c: PoolClient, empresaId: string, de: string, ate: string, vistoriadorId?: string, travar = false) {
    const linhas = (await c.query(
      `SELECT lc.id, lc.laudo_id AS "laudoId", lc.vistoriador_id AS "vistoriadorId", v.nome AS vistoriador, lc.valor_centavos AS valor, lc.devida_em AS "devidaEm",
              (lc.devida_em = 'EMISSAO' OR coalesce(t.status = 'QUITADO', true)) AS pronta
         FROM laudo_comissao lc JOIN laudo l ON l.id = lc.laudo_id JOIN vistoriador v ON v.id = lc.vistoriador_id LEFT JOIN titulo_receber t ON t.laudo_id = l.id
        WHERE lc.empresa_id = $1 AND lc.ativo AND lc.fechamento_id IS NULL AND l.status = 'ATIVO' AND l.data_laudo BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR lc.vistoriador_id = $4)
        ORDER BY v.nome, lc.id ${travar ? 'FOR UPDATE OF lc' : ''}`, [empresaId, de, ate, vistoriadorId ?? null])).rows as { id: string; laudoId: string; vistoriadorId: string; vistoriador: string; valor: number; devidaEm: string; pronta: boolean }[];
    const por = new Map<string, { vistoriadorId: string; vistoriador: string; laudos: number; totalCentavos: number; aguardandoCentavos: number; aguardandoLaudos: number; ids: string[] }>();
    for (const l of linhas) {
      const g = por.get(l.vistoriadorId) ?? { vistoriadorId: l.vistoriadorId, vistoriador: l.vistoriador, laudos: 0, totalCentavos: 0, aguardandoCentavos: 0, aguardandoLaudos: 0, ids: [] };
      if (l.pronta) { g.laudos++; g.totalCentavos += l.valor; g.ids.push(l.id); } else { g.aguardandoLaudos++; g.aguardandoCentavos += l.valor; }
      por.set(l.vistoriadorId, g);
    }
    return [...por.values()];
  }

  /** Fecha o período: uma conta a pagar por vistoriador, e cada comissão entra num fechamento uma única vez. */
  async fechar(a: Acesso, d: z.output<typeof fecharComissaoSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'comissao.fechar', empresaId);
    if (d.ate > hojeSP()) throw erroCampo('ate', 'O período ainda não terminou.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const grupos = (await this.agrupar(c, empresaId, d.de, d.ate, d.vistoriadorId, true)).filter((g) => g.totalCentavos > 0 && g.ids.length > 0);
      const criados: { id: string; vistoriador: string; laudos: number; totalCentavos: number; tituloId: string }[] = [];
      for (const g of grupos) {
        const periodo = `${br(d.de)} a ${br(d.ate)}`;
        const titulo = await inserirTituloPagar(c, a, empresaId, { beneficiario: g.vistoriador, descricao: `Comissão de ${g.vistoriador}: ${g.laudos} laudos (${periodo})`, competencia: d.ate.slice(0, 7), vencimento: d.vencimento ?? hojeSP(), valorCentavos: g.totalCentavos, origem: 'COMISSAO' });
        const fid = (await c.query(
          `INSERT INTO fechamento_comissao (grupo_id, empresa_id, vistoriador_id, periodo_ini, periodo_fim, laudos, total_centavos, titulo_pagar_id, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [a.grupoId, empresaId, g.vistoriadorId, d.de, d.ate, g.laudos, g.totalCentavos, titulo, a.usuarioId])).rows[0].id;
        await c.query('UPDATE laudo_comissao SET fechamento_id = $2 WHERE id = ANY($1::uuid[])', [g.ids, fid]);
        await auditar(c, a, { acao: 'comissao.fechada', entidade: 'fechamento_comissao', entidadeId: fid, empresaId, depois: { vistoriador: g.vistoriador, periodo, laudos: g.laudos, totalCentavos: g.totalCentavos, tituloPagarId: titulo } });
        criados.push({ id: fid, vistoriador: g.vistoriador, laudos: g.laudos, totalCentavos: g.totalCentavos, tituloId: titulo });
      }
      return { fechamentos: criados.length, criados };
    });
  }

  async fechamentos(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'comissao.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT f.id, v.nome AS vistoriador, f.periodo_ini::text AS "periodoIni", f.periodo_fim::text AS "periodoFim", f.laudos, f.total_centavos AS "totalCentavos", f.status, f.motivo_cancelamento AS "motivoCancelamento",
              f.titulo_pagar_id AS "tituloPagarId", t.status AS "statusPagar", f.criado_em AS "criadoEm"
         FROM fechamento_comissao f JOIN vistoriador v ON v.id = f.vistoriador_id LEFT JOIN titulo_pagar t ON t.id = f.titulo_pagar_id WHERE f.empresa_id = $1 ORDER BY f.criado_em DESC LIMIT 100`, [empresaId])).rows);
  }

  async cancelarFechamento(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = (await c.query(`SELECT id, empresa_id AS "empresaId", status, titulo_pagar_id AS "tituloId" FROM fechamento_comissao WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!f) throw new NotFoundException('Fechamento não encontrado.');
      exigir(a, 'comissao.fechar', f.empresaId);
      if (f.status === 'CANCELADO') throw new ConflictException('Este fechamento já foi cancelado.');
      const t = (await c.query('SELECT status, pago_centavos AS pago FROM titulo_pagar WHERE id = $1 FOR UPDATE', [f.tituloId])).rows[0];
      if (t && (t.pago > 0 || t.status === 'PAGO' || t.status === 'PARCIAL')) throw new ConflictException(`A conta a pagar desta comissão já recebeu pagamento (${formatarBRL(t.pago)}). Estorne os pagamentos antes de cancelar.`);
      if (t && t.status !== 'CANCELADO') await c.query(`UPDATE titulo_pagar SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $2, motivo_cancelamento = $3 WHERE id = $1`, [f.tituloId, a.usuarioId, `Fechamento de comissão cancelado: ${motivo}`]);
      await c.query('UPDATE laudo_comissao SET fechamento_id = NULL WHERE fechamento_id = $1', [id]);
      await c.query(`UPDATE fechamento_comissao SET status = 'CANCELADO', motivo_cancelamento = $2 WHERE id = $1`, [id, motivo]);
      await auditar(c, a, { acao: 'comissao.fechamento_cancelado', entidade: 'fechamento_comissao', entidadeId: id, empresaId: f.empresaId, motivo });
      return { ok: true };
    });
  }
}
