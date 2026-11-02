import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import {
  assinaturaSaasEdicaoSchema, assinaturaSaasSchema, baixarCobrancaSaasSchema, calcularMensalidade, competenciasDevidas, diasEntre,
  gerarPixCopiaECola, planoSaasEdicaoSchema, planoSaasSchema,
} from '@ecv/shared';
import { DbService, type ContextoDb } from '../db/db.service';
import { ENV, type Env } from '../config/env';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { exigir, contextoDb, type Acesso } from '../common/acesso';
import type { AcessoInterno } from '../backoffice/bo-acesso';

const na = (g: string): ContextoDb => ({ grupoId: g, rede: true, empresas: [] });
type Autor = { grupoId: string; usuarioInternoId?: string | null; ip?: string; userAgent?: string };
const autorDe = (grupoId: string, i?: AcessoInterno): Autor => ({ grupoId, usuarioInternoId: i?.id ?? null, ip: i?.ip, userAgent: i?.userAgent });

const COLS_ASSINATURA = `a.id, a.grupo_id AS "grupoId", a.plano_id AS "planoId", p.nome AS "planoNome", a.valor_base_centavos AS "valorBaseCentavos",
  a.empresas_incluidas AS "empresasIncluidas", a.valor_empresa_adicional_centavos AS "valorEmpresaAdicionalCentavos", a.desconto_bp AS "descontoBp",
  a.dia_vencimento AS "diaVencimento", a.inicio, a.teste_ate AS "testeAte", a.status, a.carencia_dias AS "carenciaDias",
  a.suspende_em_atraso AS "suspendeEmAtraso", a.suspenso_por_atraso AS "suspensoPorAtraso", a.cancelada_em AS "canceladaEm", a.motivo_cancelamento AS "motivoCancelamento"`;
const COLS_COBRANCA = `id, competencia, vencimento, empresas_cobradas AS "empresasCobradas", valor_bruto_centavos AS "valorBrutoCentavos",
  desconto_centavos AS "descontoCentavos", valor_centavos AS "valorCentavos", status, pago_em AS "pagoEm", forma_pagamento AS "formaPagamento",
  referencia, motivo_cancelamento AS "motivoCancelamento"`;

@Injectable()
export class AssinaturaService {
  private readonly log = new Logger('Assinatura');
  constructor(private readonly db: DbService, @Inject(ENV) private readonly env: Env) {}

  // ---------- planos (catálogo da plataforma) ----------
  listarPlanos() {
    return this.db.semTenant(async (c) => (await c.query(
      `SELECT id, nome, descricao, valor_base_centavos AS "valorBaseCentavos", empresas_incluidas AS "empresasIncluidas",
              valor_empresa_adicional_centavos AS "valorEmpresaAdicionalCentavos", ativo,
              (SELECT count(*) FROM bo_listar_assinaturas_saas() s WHERE s.plano_nome = plano_saas.nome AND s.status <> 'CANCELADA')::int AS "assinaturas"
         FROM plano_saas ORDER BY ativo DESC, valor_base_centavos`)).rows);
  }

  async criarPlano(dto: z.infer<typeof planoSaasSchema>) {
    try {
      return await this.db.semTenant(async (c) => (await c.query(
        `INSERT INTO plano_saas (nome, descricao, valor_base_centavos, empresas_incluidas, valor_empresa_adicional_centavos) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [dto.nome, dto.descricao ?? null, dto.valorBaseCentavos, dto.empresasIncluidas, dto.valorEmpresaAdicionalCentavos])).rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe um plano com este nome.');
      throw e;
    }
  }

  /** Mudar o plano não mexe nos contratos: cada assinatura guarda o preço combinado. */
  async editarPlano(id: string, dto: z.infer<typeof planoSaasEdicaoSchema>) {
    const campos: [string, unknown][] = [['nome', dto.nome], ['descricao', dto.descricao], ['valor_base_centavos', dto.valorBaseCentavos], ['empresas_incluidas', dto.empresasIncluidas],
      ['valor_empresa_adicional_centavos', dto.valorEmpresaAdicionalCentavos], ['ativo', dto.ativo]];
    const usados = campos.filter(([, v]) => v !== undefined);
    if (!usados.length) return { id };
    try {
      const r = await this.db.semTenant((c) => c.query(`UPDATE plano_saas SET ${usados.map(([k], n) => `${k} = $${n + 2}`).join(', ')} WHERE id = $1`, [id, ...usados.map(([, v]) => v)]));
      if (!r.rowCount) throw new NotFoundException('Plano não encontrado.');
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe um plano com este nome.');
      throw e;
    }
    return { id };
  }

  // ---------- assinatura de um grupo ----------
  async obter(grupoId: string) {
    return this.db.tenant(na(grupoId), async (c) => {
      const a = (await c.query(`SELECT ${COLS_ASSINATURA} FROM assinatura_saas a JOIN plano_saas p ON p.id = a.plano_id`)).rows[0] ?? null;
      const cobrancas = (await c.query(`SELECT ${COLS_COBRANCA} FROM cobranca_saas ORDER BY vencimento DESC LIMIT 60`)).rows;
      const empresas = Number((await c.query(`SELECT count(*) AS n FROM empresa WHERE status = 'ATIVO'`)).rows[0].n);
      return { assinatura: a, cobrancas, empresasAtivas: empresas };
    });
  }

  async contratar(i: AcessoInterno, grupoId: string, dto: z.infer<typeof assinaturaSaasSchema>) {
    const plano = (await this.db.semTenant((c) => c.query('SELECT * FROM plano_saas WHERE id = $1', [dto.planoId]))).rows[0];
    if (!plano) throw new NotFoundException('Plano não encontrado.');
    if (!plano.ativo) throw new UnprocessableEntityException('Este plano está desativado. Escolha outro.');
    if (dto.testeAte && dto.testeAte < dto.inicio) throw new UnprocessableEntityException('O fim do teste não pode ser antes do início.');
    return this.db.tenant(na(grupoId), async (c) => {
      if (!(await c.query('SELECT 1 FROM grupo')).rowCount) throw new NotFoundException('Grupo não encontrado.');
      const ja = (await c.query('SELECT status FROM assinatura_saas')).rows[0];
      if (ja) throw new ConflictException('Este grupo já tem assinatura. Edite o contrato existente.');
      const id = (await c.query(
        `INSERT INTO assinatura_saas (grupo_id, plano_id, valor_base_centavos, empresas_incluidas, valor_empresa_adicional_centavos, desconto_bp, dia_vencimento, inicio, teste_ate, carencia_dias, suspende_em_atraso)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [grupoId, plano.id, dto.valorBaseCentavos ?? Number(plano.valor_base_centavos), dto.empresasIncluidas ?? plano.empresas_incluidas,
          dto.valorEmpresaAdicionalCentavos ?? Number(plano.valor_empresa_adicional_centavos), dto.descontoBp, dto.diaVencimento, dto.inicio, dto.testeAte ?? null, dto.carenciaDias, dto.suspendeEmAtraso])).rows[0].id;
      await auditar(c, autorDe(grupoId, i), { acao: 'assinatura.contratada', entidade: 'assinatura_saas', entidadeId: id, depois: { plano: plano.nome, ...dto } });
      await this.gerarCobrancas(c, autorDe(grupoId, i), grupoId, hojeSP());
      return { id };
    });
  }

  /** Reajuste vale para as próximas mensalidades; as já geradas ficam como estão. */
  async editar(i: AcessoInterno, grupoId: string, dto: z.infer<typeof assinaturaSaasEdicaoSchema>) {
    const { motivo, planoId, ...resto } = dto;
    const plano = planoId ? (await this.db.semTenant((c) => c.query('SELECT id FROM plano_saas WHERE id = $1', [planoId]))).rows[0] : null;
    if (planoId && !plano) throw new NotFoundException('Plano não encontrado.');
    return this.db.tenant(na(grupoId), async (c) => {
      const antes = (await c.query('SELECT * FROM assinatura_saas FOR UPDATE')).rows[0];
      if (!antes) throw new NotFoundException('Este grupo ainda não tem assinatura.');
      if (antes.status === 'CANCELADA') throw new ConflictException('A assinatura está cancelada e não pode ser editada.');
      const campos: [string, unknown][] = [['plano_id', planoId], ['valor_base_centavos', resto.valorBaseCentavos], ['empresas_incluidas', resto.empresasIncluidas],
        ['valor_empresa_adicional_centavos', resto.valorEmpresaAdicionalCentavos], ['desconto_bp', resto.descontoBp], ['dia_vencimento', resto.diaVencimento],
        ['inicio', resto.inicio], ['teste_ate', resto.testeAte], ['carencia_dias', resto.carenciaDias], ['suspende_em_atraso', resto.suspendeEmAtraso]];
      const usados = campos.filter(([, v]) => v !== undefined);
      if (!usados.length) throw new UnprocessableEntityException('Nada para alterar.');
      await c.query(`UPDATE assinatura_saas SET ${usados.map(([k], n) => `${k} = $${n + 2}`).join(', ')}, atualizado_em = now() WHERE id = $1`, [antes.id, ...usados.map(([, v]) => v)]);
      await auditar(c, autorDe(grupoId, i), { acao: 'assinatura.editada', entidade: 'assinatura_saas', entidadeId: antes.id, antes, depois: Object.fromEntries(usados), motivo });
      await this.reavaliar(c, autorDe(grupoId, i), grupoId, hojeSP());
      return { id: antes.id };
    });
  }

  async cancelar(i: AcessoInterno, grupoId: string, motivo: string) {
    return this.db.tenant(na(grupoId), async (c) => {
      const a = (await c.query('SELECT id, status, suspenso_por_atraso FROM assinatura_saas FOR UPDATE')).rows[0];
      if (!a) throw new NotFoundException('Este grupo ainda não tem assinatura.');
      if (a.status === 'CANCELADA') throw new ConflictException('A assinatura já está cancelada.');
      await c.query(`UPDATE assinatura_saas SET status = 'CANCELADA', cancelada_em = now(), motivo_cancelamento = $2, atualizado_em = now() WHERE id = $1`, [a.id, motivo]);
      await c.query(`UPDATE cobranca_saas SET status = 'CANCELADA', motivo_cancelamento = 'Assinatura cancelada: ' || $1 WHERE status = 'ABERTA'`, [motivo]);
      await auditar(c, autorDe(grupoId, i), { acao: 'assinatura.cancelada', entidade: 'assinatura_saas', entidadeId: a.id, antes: { status: a.status }, depois: { status: 'CANCELADA' }, motivo });
      await this.liberarSuspensao(c, autorDe(grupoId, i), grupoId, a);
      return { id: a.id };
    });
  }

  // ---------- mensalidades ----------
  listarCobrancasGlobal(f: { status?: string; grupoId?: string; vencidas?: boolean }) {
    return this.db.semTenant(async (c) => (await c.query(
      `SELECT id, grupo_id AS "grupoId", grupo_nome AS "grupoNome", competencia, vencimento, valor_centavos AS "valorCentavos", status, pago_em AS "pagoEm",
              forma_pagamento AS "formaPagamento", referencia, assinatura_status AS "assinaturaStatus"
         FROM bo_listar_cobrancas_saas()
        WHERE ($1::text IS NULL OR status::text = $1) AND ($2::uuid IS NULL OR grupo_id = $2) AND (NOT $3 OR (status = 'ABERTA' AND vencimento < $4::date))`,
      [f.status ?? null, f.grupoId ?? null, !!f.vencidas, hojeSP()])).rows);
  }

  listarAssinaturasGlobal() {
    return this.db.semTenant(async (c) => (await c.query(
      `SELECT grupo_id AS "grupoId", grupo_nome AS "grupoNome", grupo_status AS "grupoStatus", plano_nome AS "planoNome", status, valor_base_centavos AS "valorBaseCentavos", teste_ate AS "testeAte"
         FROM bo_listar_assinaturas_saas()`)).rows);
  }

  async gerarAgora(i: AcessoInterno, grupoId: string) {
    return this.db.tenant(na(grupoId), async (c) => ({ geradas: await this.gerarCobrancas(c, autorDe(grupoId, i), grupoId, hojeSP()) }));
  }

  async baixar(i: AcessoInterno, grupoId: string, cobrancaId: string, dto: z.infer<typeof baixarCobrancaSaasSchema>) {
    if (dto.pagoEm > hojeSP()) throw new UnprocessableEntityException('A data do pagamento não pode ser no futuro.');
    return this.db.tenant(na(grupoId), async (c) => {
      const m = await this.travar(c, cobrancaId);
      if (m.status !== 'ABERTA') throw new ConflictException(`Esta mensalidade já está ${m.status === 'PAGA' ? 'paga' : 'cancelada'}.`);
      await c.query(`UPDATE cobranca_saas SET status = 'PAGA', pago_em = $2, forma_pagamento = $3, referencia = $4, baixado_por_interno_id = $5 WHERE id = $1`,
        [cobrancaId, dto.pagoEm, dto.forma, dto.referencia ?? null, i.id]);
      await auditar(c, autorDe(grupoId, i), { acao: 'assinatura.cobranca_paga', entidade: 'cobranca_saas', entidadeId: cobrancaId, antes: { status: 'ABERTA' }, depois: { status: 'PAGA', ...dto, valorCentavos: Number(m.valor_centavos) } });
      await this.reavaliar(c, autorDe(grupoId, i), grupoId, hojeSP());
      return { id: cobrancaId };
    });
  }

  async cancelarCobranca(i: AcessoInterno, grupoId: string, cobrancaId: string, motivo: string) {
    return this.db.tenant(na(grupoId), async (c) => {
      const m = await this.travar(c, cobrancaId);
      if (m.status !== 'ABERTA') throw new ConflictException(`Esta mensalidade já está ${m.status === 'PAGA' ? 'paga' : 'cancelada'}.`);
      await c.query(`UPDATE cobranca_saas SET status = 'CANCELADA', motivo_cancelamento = $2 WHERE id = $1`, [cobrancaId, motivo]);
      await auditar(c, autorDe(grupoId, i), { acao: 'assinatura.cobranca_cancelada', entidade: 'cobranca_saas', entidadeId: cobrancaId, antes: { status: 'ABERTA' }, depois: { status: 'CANCELADA' }, motivo });
      await this.reavaliar(c, autorDe(grupoId, i), grupoId, hojeSP());
      return { id: cobrancaId };
    });
  }

  private async travar(c: PoolClient, id: string) {
    const m = (await c.query('SELECT id, status, valor_centavos FROM cobranca_saas WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!m) throw new NotFoundException('Mensalidade não encontrada.');
    return m;
  }

  /** Cria as mensalidades que já deveriam existir. Nunca recria uma competência já gerada (nem a cancelada). */
  private async gerarCobrancas(c: PoolClient, autor: Autor, grupoId: string, hoje: string): Promise<number> {
    const a = (await c.query(`SELECT * FROM assinatura_saas WHERE status <> 'CANCELADA'`)).rows[0];
    if (!a) return 0;
    if ((await c.query('SELECT status FROM grupo')).rows[0]?.status !== 'ATIVO') return 0;
    const empresas = Number((await c.query(`SELECT count(*) AS n FROM empresa WHERE status = 'ATIVO'`)).rows[0].n);
    let criadas = 0;
    for (const d of competenciasDevidas({ inicio: a.inicio, testeAte: a.teste_ate, diaVencimento: a.dia_vencimento }, hoje)) {
      const m = calcularMensalidade({
        valorBaseCentavos: Number(a.valor_base_centavos), empresasIncluidas: a.empresas_incluidas, valorEmpresaAdicionalCentavos: Number(a.valor_empresa_adicional_centavos), descontoBp: a.desconto_bp, empresas,
      });
      const r = await c.query(
        `INSERT INTO cobranca_saas (grupo_id, assinatura_id, competencia, vencimento, empresas_cobradas, valor_bruto_centavos, desconto_centavos, valor_centavos)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM cobranca_saas WHERE assinatura_id = $2 AND competencia = $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [grupoId, a.id, d.competencia, d.vencimento, m.empresasCobradas, m.brutoCentavos, m.descontoCentavos, m.valorCentavos]);
      if (r.rowCount) {
        criadas++;
        await auditar(c, autor, { acao: 'assinatura.cobranca_gerada', entidade: 'cobranca_saas', entidadeId: r.rows[0].id, depois: { competencia: d.competencia, vencimento: d.vencimento, valorCentavos: m.valorCentavos, empresas: m.empresasCobradas } });
      }
    }
    return criadas;
  }

  /** Atrasou além da carência: assinatura vira INADIMPLENTE (e o grupo é suspenso, se o contrato prevê). Pagou tudo: volta ao normal. */
  private async reavaliar(c: PoolClient, autor: Autor, grupoId: string, hoje: string) {
    const a = (await c.query('SELECT * FROM assinatura_saas FOR UPDATE')).rows[0];
    if (!a || a.status === 'CANCELADA') return;
    const abertas = (await c.query(`SELECT vencimento FROM cobranca_saas WHERE status = 'ABERTA'`)).rows as { vencimento: string }[];
    const emAtraso = abertas.some((m) => diasEntre(m.vencimento, hoje) > a.carencia_dias);
    if (emAtraso && a.status === 'ATIVA') {
      await c.query(`UPDATE assinatura_saas SET status = 'INADIMPLENTE', atualizado_em = now() WHERE id = $1`, [a.id]);
      await auditar(c, autor, { acao: 'assinatura.inadimplente', entidade: 'assinatura_saas', entidadeId: a.id, antes: { status: 'ATIVA' }, depois: { status: 'INADIMPLENTE' }, motivo: `Mensalidade vencida há mais de ${a.carencia_dias} dias.` });
    }
    if (emAtraso && a.suspende_em_atraso && !a.suspenso_por_atraso) {
      const g = (await c.query('SELECT status FROM grupo')).rows[0];
      if (g?.status === 'ATIVO') {
        await c.query(`UPDATE grupo SET status = 'SUSPENSO' WHERE id = $1`, [grupoId]);
        await c.query('UPDATE assinatura_saas SET suspenso_por_atraso = true WHERE id = $1', [a.id]);
        await auditar(c, autor, { acao: 'grupo.suspenso', entidade: 'grupo', entidadeId: grupoId, antes: { status: 'ATIVO' }, depois: { status: 'SUSPENSO' }, motivo: 'Suspenso por inadimplência da assinatura.' });
      }
    }
    if (!emAtraso && a.status === 'INADIMPLENTE') {
      await c.query(`UPDATE assinatura_saas SET status = 'ATIVA', atualizado_em = now() WHERE id = $1`, [a.id]);
      await auditar(c, autor, { acao: 'assinatura.regularizada', entidade: 'assinatura_saas', entidadeId: a.id, antes: { status: 'INADIMPLENTE' }, depois: { status: 'ATIVA' } });
    }
    if (!emAtraso) await this.liberarSuspensao(c, autor, grupoId, a);
  }

  /** Só reativa o grupo que foi suspenso pela própria cobrança; suspensão manual da equipe continua valendo. */
  private async liberarSuspensao(c: PoolClient, autor: Autor, grupoId: string, a: { id: string; suspenso_por_atraso: boolean }) {
    if (!a.suspenso_por_atraso) return;
    await c.query(`UPDATE grupo SET status = 'ATIVO' WHERE id = $1 AND status = 'SUSPENSO'`, [grupoId]);
    await c.query('UPDATE assinatura_saas SET suspenso_por_atraso = false WHERE id = $1', [a.id]);
    await auditar(c, autor, { acao: 'grupo.reativado', entidade: 'grupo', entidadeId: grupoId, antes: { status: 'SUSPENSO' }, depois: { status: 'ATIVO' }, motivo: 'Assinatura regularizada.' });
  }

  /** Rotina diária: gera as mensalidades que vencem em breve e confere atrasos. Grupos já suspensos por atraso voltam pelo pagamento. */
  async processarTodas(hoje = hojeSP()) {
    const grupos = (await this.db.semTenant((c) => c.query(`SELECT grupo_id AS id FROM bo_listar_assinaturas_saas() WHERE status <> 'CANCELADA'`))).rows as { id: string }[];
    let geradas = 0;
    for (const g of grupos) {
      try {
        await this.db.tenant(na(g.id), async (c) => {
          geradas += await this.gerarCobrancas(c, { grupoId: g.id }, g.id, hoje);
          await this.reavaliar(c, { grupoId: g.id }, g.id, hoje);
        });
      } catch (e) { this.log.error(`Grupo ${g.id}: ${(e as Error).message}`); }
    }
    return { grupos: grupos.length, geradas };
  }

  // ---------- visão do cliente ----------
  async minha(a: Acesso) {
    exigir(a, 'assinatura.ver');
    const dados = await this.db.tenant(contextoDb(a), async (c) => {
      const ass = (await c.query(`SELECT ${COLS_ASSINATURA} FROM assinatura_saas a JOIN plano_saas p ON p.id = a.plano_id`)).rows[0] ?? null;
      const cobrancas = (await c.query(`SELECT ${COLS_COBRANCA} FROM cobranca_saas ORDER BY vencimento DESC LIMIT 24`)).rows;
      const empresas = Number((await c.query(`SELECT count(*) AS n FROM empresa WHERE status = 'ATIVO'`)).rows[0].n);
      const grupo = (await c.query('SELECT nome FROM grupo')).rows[0];
      return { assinatura: ass, cobrancas, empresasAtivas: empresas, grupoNome: grupo?.nome as string };
    });
    const hoje = hojeSP();
    const proxima = [...dados.cobrancas].filter((m) => m.status === 'ABERTA').sort((x, y) => (x.vencimento < y.vencimento ? -1 : 1))[0] ?? null;
    const e = this.env;
    const pix = proxima && e.ECV_PIX_CHAVE && e.ECV_PIX_TIPO
      ? gerarPixCopiaECola({ tipoChave: e.ECV_PIX_TIPO, chave: e.ECV_PIX_CHAVE, nomeRecebedor: e.ECV_PIX_NOME, cidade: e.ECV_PIX_CIDADE, valorCentavos: Number(proxima.valorCentavos), identificador: `ASS${String(proxima.competencia).slice(0, 7).replace('-', '')}${String(proxima.id).slice(0, 8)}` })
      : null;
    const cobrancas = dados.cobrancas.map((m) => ({ ...m, emAtraso: m.status === 'ABERTA' && m.vencimento < hoje }));
    const atraso = cobrancas.filter((m) => m.emAtraso).length;
    return { ...dados, cobrancas, proxima, pix, mensalidadesEmAtraso: atraso, emTeste: !!dados.assinatura?.testeAte && dados.assinatura.testeAte >= hoje };
  }

  /** Aviso curto para o banner do sistema (só Administrativo). */
  async aviso(a: Acesso) {
    if (!a.rede) return { tipo: 'nenhum' as const };
    const m = await this.minha(a);
    if (!m.assinatura || m.assinatura.status === 'CANCELADA') return { tipo: 'nenhum' as const };
    if (m.mensalidadesEmAtraso > 0) return { tipo: 'atraso' as const, quantidade: m.mensalidadesEmAtraso, vencimento: m.cobrancas.filter((x) => x.emAtraso).map((x) => x.vencimento).sort()[0] };
    if (m.proxima && diasEntre(hojeSP(), m.proxima.vencimento) <= 5) return { tipo: 'vencendo' as const, vencimento: m.proxima.vencimento, valorCentavos: Number(m.proxima.valorCentavos) };
    return { tipo: 'nenhum' as const };
  }
}
