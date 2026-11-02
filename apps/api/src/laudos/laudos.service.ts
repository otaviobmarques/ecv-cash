import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { custoDoLaudo, descontoDoLaudo, itemLoteSchema, resolverPreco, temPermissao, type editarLaudoSchema, type filtroLaudosSchema, type laudoSchema, type loteSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { ClientesService } from '../cadastros/clientes';
import { cancelarTituloDoLaudo, criarTituloDoLaudo, sincronizarTituloDoLaudo } from '../receber/titulo';

type Lancamento = z.output<typeof laudoSchema>;
type Edicao = z.output<typeof editarLaudoSchema>;
type Filtro = z.output<typeof filtroLaudosSchema>;

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });

const SELECT = `
  SELECT l.id, l.numero_interno::int AS numero, l.numero_laudo AS "numeroLaudo", l.empresa_id AS "empresaId", l.placa, l.chassi, l.data_laudo::text AS "dataLaudo",
         l.cliente_id AS "clienteId", c.nome AS cliente, l.servico_id AS "servicoId", s.nome AS servico, l.vistoriador_id AS "vistoriadorId", v.nome AS vistoriador,
         l.forma_pagamento_id AS "formaPagamentoId", f.nome AS forma, l.preco_tabela_centavos AS "precoTabelaCentavos", l.preco_manual AS "precoManual",
         l.valor_cobrado_centavos AS "valorCobradoCentavos", l.ajuste_motivo AS "ajusteMotivo", l.duplicidade_motivo AS "duplicidadeMotivo", l.observacao, l.status,
         l.cancelamento_pedido_em AS "cancelamentoPedidoEm", l.cancelamento_pedido_motivo AS "cancelamentoPedidoMotivo", pu.nome AS "cancelamentoPedidoPor",
         l.cancelamento_pedido_por AS "cancelamentoPedidoPorId", l.cancelado_em AS "canceladoEm", l.motivo_cancelamento AS "motivoCancelamento",
         l.revisado_em AS "revisadoEm", (l.travado_em IS NOT NULL) AS travado, l.criado_em AS "criadoEm", u.nome AS "criadoPor",
         coalesce((SELECT sum(lc.valor_centavos) FROM laudo_custo lc WHERE lc.laudo_id = l.id AND lc.ativo), 0)::int AS "custosCentavos"
    FROM laudo l
    JOIN cliente c ON c.id = l.cliente_id JOIN servico s ON s.id = l.servico_id JOIN vistoriador v ON v.id = l.vistoriador_id JOIN forma_pagamento f ON f.id = l.forma_pagamento_id
    LEFT JOIN usuario u ON u.id = l.criado_por LEFT JOIN usuario pu ON pu.id = l.cancelamento_pedido_por`;

@Injectable()
export class LaudosService {
  constructor(private readonly db: DbService, private readonly clientes: ClientesService) {}

  /** Margem e custos são de Administrativo e Gerente; os demais perfis recebem o laudo sem esses campos. */
  private dto(a: Acesso, l: Record<string, unknown> & { empresaId: string; valorCobradoCentavos: number; custosCentavos: number }) {
    const perfil = perfilEm(a, l.empresaId);
    const { custosCentavos, ...resto } = l;
    const desconto = descontoDoLaudo(l.precoTabelaCentavos as number | null, l.valorCobradoCentavos);
    const base = { ...resto, descontoCentavos: desconto };
    return perfil && temPermissao(perfil, 'relatorio.margem') ? { ...base, custosCentavos, margemCentavos: l.valorCobradoCentavos - custosCentavos } : base;
  }

  private async meuVistoriador(c: PoolClient, a: Acesso): Promise<string | null> {
    return (await c.query(`SELECT id FROM vistoriador WHERE usuario_id = $1 AND status = 'ATIVO'`, [a.usuarioId])).rows[0]?.id ?? null;
  }

  private async ler(c: PoolClient, a: Acesso, id: string) {
    const l = (await c.query(`${SELECT} WHERE l.id = $1`, [id])).rows[0];
    if (!l) throw new NotFoundException('Laudo não encontrado.');
    if (perfilEm(a, l.empresaId) === 'VISTORIADOR' && l.vistoriadorId !== (await this.meuVistoriador(c, a))) throw new NotFoundException('Laudo não encontrado.');
    return l;
  }

  private async precoVigente(c: PoolClient, clienteId: string, servicoId: string, data: string): Promise<number | null> {
    const r = (await c.query(`SELECT valor_centavos AS v FROM cliente_preco WHERE cliente_id = $1 AND servico_id = $2 AND vigencia_ini <= $3 AND (vigencia_fim IS NULL OR vigencia_fim >= $3)`, [clienteId, servicoId, data])).rows[0];
    return r ? r.v : null;
  }

  /** Grava o custo direto do serviço no laudo. Os anteriores, se houver, ficam inativos. */
  private async gravarCustos(c: PoolClient, a: Acesso, empresaId: string, laudoId: string, servicoId: string, valorCobrado: number) {
    await c.query('UPDATE laudo_custo SET ativo = false WHERE laudo_id = $1 AND ativo', [laudoId]);
    const custos = (await c.query(`SELECT id, descricao, tipo, valor_centavos AS "valorCentavos", percentual_bp AS "percentualBp", fornecedor_id AS "fornecedorId", gera_conta_pagar AS "geraContaPagar" FROM servico_custo WHERE servico_id = $1 AND status = 'ATIVO'`, [servicoId])).rows;
    for (const k of custos) {
      await c.query(
        `INSERT INTO laudo_custo (grupo_id, empresa_id, laudo_id, servico_custo_id, descricao, tipo, valor_centavos, fornecedor_id, gera_conta_pagar) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [a.grupoId, empresaId, laudoId, k.id, k.descricao, k.tipo, custoDoLaudo(k, valorCobrado), k.fornecedorId, k.geraContaPagar],
      );
    }
  }

  private async duplicados(c: PoolClient, empresaId: string, placa: string, servicoId: string, data: string, ignorar?: string) {
    return (await c.query(
      `SELECT l.id, l.numero_interno::int AS numero, v.nome AS vistoriador FROM laudo l JOIN vistoriador v ON v.id = l.vistoriador_id
        WHERE l.empresa_id = $1 AND l.placa = $2 AND l.servico_id = $3 AND l.data_laudo = $4 AND l.status = 'ATIVO' AND ($5::uuid IS NULL OR l.id <> $5)`,
      [empresaId, placa, servicoId, data, ignorar ?? null])).rows;
  }

  /** O aviso de duplicidade vale para quem não pode liberar; Gerente e Administrativo liberam com motivo. */
  private async checarDuplicidade(c: PoolClient, a: Acesso, empresaId: string, placa: string, servicoId: string, data: string, confirmar: boolean | undefined, motivo: string | undefined, ignorar?: string) {
    const dup = await this.duplicados(c, empresaId, placa, servicoId, data, ignorar);
    if (dup.length === 0) return null;
    const pode = temPermissao(perfilEm(a, empresaId)!, 'laudo.desconto');
    if (!confirmar || !pode || !motivo) {
      throw new ConflictException({
        codigo: 'DUPLICADO', duplicados: dup, podeLiberar: pode,
        mensagem: `Já existe laudo de ${placa} para este serviço nesta data (nº ${dup[0].numero}, ${dup[0].vistoriador}).${pode ? ' Para lançar mesmo assim, confirme e explique o motivo.' : ' Peça ao gerente para liberar.'}`,
      });
    }
    return motivo;
  }

  async lancarUm(c: PoolClient, a: Acesso, d: Lancamento, empresaId: string, loteId?: string) {
    exigir(a, 'laudo.lancar', empresaId);
    const perfil = perfilEm(a, empresaId)!;
    const hoje = hojeSP();
    const data = d.dataLaudo ?? hoje;
    if (data > hoje) throw erroCampo('dataLaudo', 'A data do laudo não pode ser futura.');
    if (perfil === 'VISTORIADOR' && data !== hoje) throw erroCampo('dataLaudo', 'O vistoriador lança os laudos do dia. Para uma data anterior, peça ao gerente.');

    let vistoriadorId: string;
    if (perfil === 'VISTORIADOR') {
      const meu = await this.meuVistoriador(c, a);
      if (!meu) throw new ConflictException('Seu usuário ainda não está ligado a um cadastro de vistoriador. Peça ao gerente para ligar em Cadastros > Vistoriadores.');
      vistoriadorId = meu;
    } else {
      if (!d.vistoriadorId) throw erroCampo('vistoriadorId', 'Escolha o vistoriador.');
      const ok = (await c.query(`SELECT 1 FROM vistoriador v JOIN vistoriador_empresa ve ON ve.vistoriador_id = v.id WHERE v.id = $1 AND ve.empresa_id = $2 AND v.status = 'ATIVO'`, [d.vistoriadorId, empresaId])).rows[0];
      if (!ok) throw erroCampo('vistoriadorId', 'Este vistoriador não atua nesta loja ou está inativo.');
      vistoriadorId = d.vistoriadorId;
    }
    const ativos = (await c.query(
      `SELECT (SELECT status FROM cliente WHERE id = $1) AS cliente, (SELECT status FROM servico WHERE id = $2) AS servico, (SELECT status FROM forma_pagamento WHERE id = $3) AS forma`,
      [d.clienteId, d.servicoId, d.formaPagamentoId])).rows[0];
    if (ativos.cliente !== 'ATIVO') throw erroCampo('clienteId', 'Escolha um cliente ativo.');
    if (ativos.servico !== 'ATIVO') throw erroCampo('servicoId', 'Escolha um serviço ativo.');
    if (ativos.forma !== 'ATIVO') throw erroCampo('formaPagamentoId', 'Escolha uma forma de pagamento ativa.');

    const tabela = await this.precoVigente(c, d.clienteId, d.servicoId, data);
    if (tabela !== null && d.valorCobradoCentavos !== undefined && d.valorCobradoCentavos !== tabela) {
      exigir(a, 'laudo.desconto', empresaId);
      if (!d.ajusteMotivo) throw erroCampo('ajusteMotivo', 'Explique o motivo de cobrar um valor diferente da tabela.');
    }
    if (tabela === null) exigir(a, 'laudo.preco_manual', empresaId);
    const preco = resolverPreco({ precoTabela: tabela, valorManual: d.valorManualCentavos, valorCobrado: d.valorCobradoCentavos });
    if ('erro' in preco) throw erroCampo(preco.erro === 'SEM_PRECO' ? 'valorManualCentavos' : 'valorCobradoCentavos', preco.erro === 'SEM_PRECO' ? 'Este cliente não tem preço para o serviço nesta data. Informe o valor do laudo.' : 'Valor inválido.');

    const duplMotivo = await this.checarDuplicidade(c, a, empresaId, d.placa, d.servicoId, data, d.confirmarDuplicidade, d.motivoDuplicidade);
    let id: string;
    try {
      id = (await c.query(
        `INSERT INTO laudo (grupo_id, empresa_id, numero_laudo, placa, chassi, data_laudo, cliente_id, servico_id, vistoriador_id, forma_pagamento_id, preco_tabela_centavos, preco_manual,
                            valor_cobrado_centavos, ajuste_motivo, duplicidade_motivo, observacao, lote_id, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [a.grupoId, empresaId, d.numeroLaudo ?? null, d.placa, d.chassi ?? null, data, d.clienteId, d.servicoId, vistoriadorId, d.formaPagamentoId, preco.precoTabela, preco.precoManual,
         preco.valorCobrado, preco.precisaMotivo ? d.ajusteMotivo : null, duplMotivo, d.observacao ?? null, loteId ?? null, a.usuarioId])).rows[0].id;
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).constraint === 'laudo_numero_uq') throw erroCampo('numeroLaudo', 'Já existe um laudo ativo com este número nesta loja.');
      throw e;
    }
    await this.gravarCustos(c, a, empresaId, id, d.servicoId, preco.valorCobrado);
    await criarTituloDoLaudo(c, id);
    const laudo = await this.ler(c, a, id);
    await auditar(c, a, { acao: 'laudo.lancado', entidade: 'laudo', entidadeId: id, empresaId, depois: { numero: laudo.numero, placa: laudo.placa, cliente: laudo.cliente, servico: laudo.servico, valorCobradoCentavos: laudo.valorCobradoCentavos, precoManual: laudo.precoManual }, motivo: preco.precisaMotivo ? d.ajusteMotivo : duplMotivo ?? undefined });
    return this.dto(a, laudo);
  }

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  lancar(a: Acesso, d: Lancamento) {
    const empresaId = this.empresaAtiva(a);
    return this.db.tenant(contextoDb(a), (c) => this.lancarUm(c, a, d, empresaId));
  }

  /** Cada linha vale por si: as boas entram e as com erro voltam com a mensagem, sem derrubar o lote inteiro. */
  async lote(a: Acesso, d: z.output<typeof loteSchema>) {
    const empresaId = this.empresaAtiva(a);
    const lote = crypto.randomUUID();
    const resultados: { linha: number; ok: boolean; laudo?: unknown; erro?: string; campos?: Record<string, string>; codigo?: string }[] = [];
    for (const [i, bruto] of d.itens.entries()) {
      const r = itemLoteSchema.safeParse(bruto);
      if (!r.success) { resultados.push({ linha: i, ok: false, erro: r.error.issues[0]?.message ?? 'Linha inválida.', campos: Object.fromEntries(r.error.issues.map((x) => [String(x.path[0]), x.message])) }); continue; }
      try {
        const laudo = await this.db.tenant(contextoDb(a), (c) => this.lancarUm(c, a, { ...r.data, dataLaudo: d.dataLaudo, vistoriadorId: d.vistoriadorId }, empresaId, lote));
        resultados.push({ linha: i, ok: true, laudo });
      } catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { mensagem?: string; campos?: Record<string, string>; codigo?: string } | undefined;
        if (!resp) throw e;
        resultados.push({ linha: i, ok: false, erro: resp.mensagem ?? 'Não foi possível lançar esta linha.', campos: resp.campos, codigo: resp.codigo });
      }
    }
    return { lote, lancados: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).length, resultados };
  }

  async listar(a: Acesso, f: Filtro) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const onde: string[] = []; const p: unknown[] = [];
      const add = (sql: string, v: unknown) => { p.push(v); onde.push(sql.replace('?', `$${p.length}`)); };
      if (f.de) add('l.data_laudo >= ?', f.de);
      if (f.ate) add('l.data_laudo <= ?', f.ate);
      if (f.placa) add(`l.placa LIKE ? || '%'`, f.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (f.clienteId) add('l.cliente_id = ?', f.clienteId);
      if (f.servicoId) add('l.servico_id = ?', f.servicoId);
      if (f.vistoriadorId) add('l.vistoriador_id = ?', f.vistoriadorId);
      if (f.status) add('l.status = ?::status_laudo', f.status);
      if (f.revisar) onde.push(`l.preco_manual AND l.revisado_em IS NULL AND l.status = 'ATIVO'`);
      if (f.cancelamentoPedido) onde.push(`l.cancelamento_pedido_em IS NOT NULL AND l.status = 'ATIVO'`);
      if (f.antesDoNumero) add('l.numero_interno < ?', f.antesDoNumero);
      if (a.empresaAtivaId && !a.rede) { /* a loja ativa filtra; o isolamento entre lojas é do banco */ }
      const vis = a.empresas.some((e) => e.perfil === 'VISTORIADOR') && !a.rede;
      if (vis) { const meu = await this.meuVistoriador(c, a); add('l.vistoriador_id = ?', meu ?? '00000000-0000-0000-0000-000000000000'); }
      if (a.empresaAtivaId) add('l.empresa_id = ?', a.empresaAtivaId);
      p.push(f.limite + 1);
      const rows = (await c.query(`${SELECT} ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY l.numero_interno DESC LIMIT $${p.length}`, p)).rows;
      const itens = rows.slice(0, f.limite).map((r) => this.dto(a, r));
      return { itens, proximoAntesDoNumero: rows.length > f.limite ? (rows[f.limite - 1].numero as number) : null };
    });
  }

  async detalhe(a: Acesso, id: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const l = await this.ler(c, a, id);
      const base = this.dto(a, l);
      if (!('margemCentavos' in base)) return base;
      const custos = (await c.query(`SELECT descricao, tipo, valor_centavos AS "valorCentavos", gera_conta_pagar AS "geraContaPagar" FROM laudo_custo WHERE laudo_id = $1 AND ativo ORDER BY descricao`, [id])).rows;
      return { ...base, custos };
    });
  }

  async editar(a: Acesso, id: string, d: Edicao) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const atual = await this.ler(c, a, id);
      await c.query('SELECT 1 FROM laudo WHERE id = $1 FOR UPDATE', [id]);
      const empresaId: string = atual.empresaId;
      const perfil = perfilEm(a, empresaId)!;
      if (atual.status !== 'ATIVO') throw new ConflictException('Laudo cancelado não pode ser editado.');
      if (atual.travado) throw new ConflictException('Este laudo já está em uma fatura ou recebeu baixa. Cancele a fatura ou estorne a baixa antes de editar.');
      const hoje = hojeSP();
      if (perfil === 'VISTORIADOR') {
        exigir(a, 'laudo.editar_proprio_dia', empresaId);
        if (atual.dataLaudo !== hoje) throw new ForbiddenException('O vistoriador só edita o próprio laudo no mesmo dia. Peça ao gerente.');
        if (d.vistoriadorId || d.dataLaudo || d.valorCobradoCentavos !== undefined) throw new ForbiddenException('O vistoriador não altera valor, data nem vistoriador do laudo.');
      } else exigir(a, 'laudo.editar', empresaId);
      if (d.vistoriadorId) {
        const ok = (await c.query(`SELECT 1 FROM vistoriador v JOIN vistoriador_empresa ve ON ve.vistoriador_id = v.id WHERE v.id = $1 AND ve.empresa_id = $2 AND v.status = 'ATIVO'`, [d.vistoriadorId, empresaId])).rows[0];
        if (!ok) throw erroCampo('vistoriadorId', 'Este vistoriador não atua nesta loja ou está inativo.');
      }
      const novo = {
        placa: d.placa ?? atual.placa, data: d.dataLaudo ?? atual.dataLaudo, clienteId: d.clienteId ?? atual.clienteId, servicoId: d.servicoId ?? atual.servicoId,
      };
      if (novo.data > hoje) throw erroCampo('dataLaudo', 'A data do laudo não pode ser futura.');
      const mudaPreco = novo.data !== atual.dataLaudo || novo.clienteId !== atual.clienteId || novo.servicoId !== atual.servicoId || d.valorCobradoCentavos !== undefined || d.valorManualCentavos !== undefined;
      let preco = { precoTabela: atual.precoTabelaCentavos as number | null, precoManual: atual.precoManual as boolean, valorCobrado: atual.valorCobradoCentavos as number, precisaMotivo: false };
      if (mudaPreco) {
        const tabela = await this.precoVigente(c, novo.clienteId, novo.servicoId, novo.data);
        if (tabela !== null && d.valorCobradoCentavos !== undefined && d.valorCobradoCentavos !== tabela) {
          exigir(a, 'laudo.desconto', empresaId);
          if (!d.ajusteMotivo) throw erroCampo('ajusteMotivo', 'Explique o motivo de cobrar um valor diferente da tabela.');
        }
        const mesmoAlvo = novo.clienteId === atual.clienteId && novo.servicoId === atual.servicoId;
        const r = resolverPreco({ precoTabela: tabela, valorManual: d.valorManualCentavos ?? (tabela === null && mesmoAlvo && atual.precoManual ? atual.valorCobradoCentavos : undefined), valorCobrado: d.valorCobradoCentavos });
        if ('erro' in r) throw erroCampo(r.erro === 'SEM_PRECO' ? 'valorManualCentavos' : 'valorCobradoCentavos', r.erro === 'SEM_PRECO' ? 'Este cliente não tem preço para o serviço nesta data. Informe o valor do laudo.' : 'Valor inválido.');
        preco = r;
      }
      let duplMotivo: string | null = atual.duplicidadeMotivo;
      if (novo.placa !== atual.placa || novo.servicoId !== atual.servicoId || novo.data !== atual.dataLaudo) {
        duplMotivo = (await this.checarDuplicidade(c, a, empresaId, novo.placa, novo.servicoId, novo.data, d.confirmarDuplicidade, d.motivoDuplicidade, id)) ?? duplMotivo;
      }
      if (d.formaPagamentoId) {
        if ((await c.query(`SELECT status FROM forma_pagamento WHERE id = $1`, [d.formaPagamentoId])).rows[0]?.status !== 'ATIVO') throw erroCampo('formaPagamentoId', 'Escolha uma forma de pagamento ativa.');
      }
      try {
        await c.query(
          `UPDATE laudo SET placa = $2, chassi = CASE WHEN $3::boolean THEN $4 ELSE chassi END, numero_laudo = CASE WHEN $5::boolean THEN $6 ELSE numero_laudo END, data_laudo = $7,
                  cliente_id = $8, servico_id = $9, vistoriador_id = coalesce($10, vistoriador_id), forma_pagamento_id = coalesce($11, forma_pagamento_id),
                  preco_tabela_centavos = $12, preco_manual = $13, valor_cobrado_centavos = $14, ajuste_motivo = $15, duplicidade_motivo = $16,
                  observacao = CASE WHEN $17::boolean THEN $18 ELSE observacao END
            WHERE id = $1`,
          [id, novo.placa, d.chassi !== undefined, d.chassi ?? null, d.numeroLaudo !== undefined, d.numeroLaudo ?? null, novo.data, novo.clienteId, novo.servicoId, d.vistoriadorId ?? null, d.formaPagamentoId ?? null,
           preco.precoTabela, preco.precoManual, preco.valorCobrado, preco.precisaMotivo ? d.ajusteMotivo : mudaPreco ? null : atual.ajusteMotivo, duplMotivo, d.observacao !== undefined, d.observacao ?? null]);
      } catch (e) {
        if ((e as { constraint?: string }).constraint === 'laudo_numero_uq') throw erroCampo('numeroLaudo', 'Já existe um laudo ativo com este número nesta loja.');
        throw e;
      }
      if (mudaPreco || novo.servicoId !== atual.servicoId) await this.gravarCustos(c, a, empresaId, id, novo.servicoId, preco.valorCobrado);
      await sincronizarTituloDoLaudo(c, id);
      const depois = await this.ler(c, a, id);
      const campos = ['placa', 'chassi', 'numeroLaudo', 'dataLaudo', 'cliente', 'servico', 'vistoriador', 'forma', 'valorCobradoCentavos', 'precoTabelaCentavos', 'precoManual', 'observacao'];
      const pick = (o: Record<string, unknown>) => Object.fromEntries(campos.map((k) => [k, o[k]]));
      await auditar(c, a, { acao: 'laudo.editado', entidade: 'laudo', entidadeId: id, empresaId, antes: pick(atual), depois: pick(depois), motivo: d.ajusteMotivo ?? d.motivoDuplicidade });
      return this.dto(a, depois);
    });
  }

  async solicitarCancelamento(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const l = await this.ler(c, a, id);
      exigir(a, 'laudo.cancelamento_solicitar', l.empresaId);
      if (l.status !== 'ATIVO') throw new ConflictException('Este laudo já está cancelado.');
      if (l.travado) throw new ConflictException('Este laudo já está em uma fatura ou recebeu baixa. Cancele a fatura ou estorne a baixa antes.');
      if (l.cancelamentoPedidoEm) throw new ConflictException('Já existe um pedido de cancelamento para este laudo, aguardando o gerente.');
      await c.query('UPDATE laudo SET cancelamento_pedido_por = $2, cancelamento_pedido_em = now(), cancelamento_pedido_motivo = $3 WHERE id = $1', [id, a.usuarioId, motivo]);
      await auditar(c, a, { acao: 'laudo.cancelamento_solicitado', entidade: 'laudo', entidadeId: id, empresaId: l.empresaId, motivo });
      return this.dto(a, await this.ler(c, a, id));
    });
  }

  async cancelar(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const l = await this.ler(c, a, id);
      exigir(a, 'laudo.cancelamento_autorizar', l.empresaId);
      if (l.status !== 'ATIVO') throw new ConflictException('Este laudo já está cancelado.');
      if (l.travado) throw new ConflictException('Este laudo já está em uma fatura ou recebeu baixa. Cancele a fatura ou estorne a baixa antes.');
      if (l.cancelamentoPedidoPorId === a.usuarioId) throw new ForbiddenException('Quem pediu o cancelamento não pode autorizá-lo. Peça a outro gerente ou ao Administrativo.');
      await c.query(`UPDATE laudo SET status = 'CANCELADO', cancelado_por = $2, cancelado_em = now(), motivo_cancelamento = $3 WHERE id = $1`, [id, a.usuarioId, motivo]);
      await cancelarTituloDoLaudo(c, id, `Laudo cancelado: ${motivo}`);
      await auditar(c, a, { acao: 'laudo.cancelado', entidade: 'laudo', entidadeId: id, empresaId: l.empresaId, motivo, antes: { status: 'ATIVO' }, depois: { status: 'CANCELADO', pedidoDe: l.cancelamentoPedidoPor ?? null } });
      return this.dto(a, await this.ler(c, a, id));
    });
  }

  async rejeitarCancelamento(a: Acesso, id: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const l = await this.ler(c, a, id);
      exigir(a, 'laudo.cancelamento_autorizar', l.empresaId);
      if (!l.cancelamentoPedidoEm) throw new ConflictException('Este laudo não tem pedido de cancelamento.');
      await c.query('UPDATE laudo SET cancelamento_pedido_por = NULL, cancelamento_pedido_em = NULL, cancelamento_pedido_motivo = NULL WHERE id = $1', [id]);
      await auditar(c, a, { acao: 'laudo.cancelamento_rejeitado', entidade: 'laudo', entidadeId: id, empresaId: l.empresaId, motivo, antes: { pedidoDe: l.cancelamentoPedidoPor, motivoDoPedido: l.cancelamentoPedidoMotivo } });
      return this.dto(a, await this.ler(c, a, id));
    });
  }

  /** O Gerente confere os laudos com preço digitado. Pode também transformar o valor no preço cadastrado do cliente. */
  async revisar(a: Acesso, id: string, promover: boolean) {
    const l = await this.db.tenant(contextoDb(a), (c) => this.ler(c, a, id));
    exigir(a, 'laudo.revisar_preco_manual', l.empresaId);
    if (!l.precoManual) throw new BadRequestException('Este laudo usou o preço da tabela, não há o que revisar.');
    if (l.revisadoEm) throw new ConflictException('Este laudo já foi revisado.');
    let promovido = null;
    if (promover) promovido = await this.clientes.definirPreco(a, l.clienteId, { servicoId: l.servicoId, valorCentavos: l.valorCobradoCentavos });
    return this.db.tenant(contextoDb(a), async (c) => {
      await c.query('UPDATE laudo SET revisado_por = $2, revisado_em = now() WHERE id = $1', [id, a.usuarioId]);
      await auditar(c, a, { acao: 'laudo.preco_manual_revisado', entidade: 'laudo', entidadeId: id, empresaId: l.empresaId, depois: { promoveuPreco: !!promovido, valorCentavos: l.valorCobradoCentavos } });
      return this.dto(a, await this.ler(c, a, id));
    });
  }
}
