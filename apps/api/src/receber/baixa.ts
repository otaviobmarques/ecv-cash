import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { calcularAtraso, formatarBRL, temPermissao } from '@ecv/shared';
import { Acesso, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { estornarLancamento, hojeSP, registrarLancamento, ultimoDiaFechado } from '../caixa/razao';
import { recalcularTitulo } from './titulo';

const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });

export interface OpcoesBaixa {
  tituloId: string; data?: string; principalCentavos?: number; contaId?: string; formaPagamentoId?: string;
  perdoarEncargos?: boolean; perdaoCentavos?: number; motivo?: string; loteId?: string;
}

export interface TituloParaBaixa {
  id: string; empresaId: string; laudoId: string; clienteId: string; formaPagamentoId: string; valorCentavos: number; pagoCentavos: number; vencimento: string; status: string;
  multaBp: number; jurosMesBp: number; dataLaudo: string; numero: number; placa: string; cliente: string; contaReceitaId: string | null;
}

export async function lerTituloParaBaixa(c: PoolClient, tituloId: string, travar = false): Promise<TituloParaBaixa> {
  const t = (await c.query(
    `SELECT t.id, t.empresa_id AS "empresaId", t.laudo_id AS "laudoId", t.cliente_id AS "clienteId", t.forma_pagamento_id AS "formaPagamentoId", t.valor_centavos AS "valorCentavos",
            t.pago_centavos AS "pagoCentavos", t.vencimento::text AS vencimento, t.status, cl.multa_bp AS "multaBp", cl.juros_mes_bp AS "jurosMesBp",
            l.data_laudo::text AS "dataLaudo", l.numero_interno::int AS numero, l.placa, cl.nome AS cliente, s.conta_receita_id AS "contaReceitaId"
       FROM titulo_receber t JOIN laudo l ON l.id = t.laudo_id JOIN cliente cl ON cl.id = t.cliente_id JOIN servico s ON s.id = l.servico_id
      WHERE t.id = $1 ${travar ? 'FOR UPDATE OF t' : ''}`, [tituloId])).rows[0];
  if (!t) throw new NotFoundException('Título não encontrado.');
  return t;
}

/** Encargos de atraso sobre a parte do principal que está sendo paga: a multa e os juros acompanham o que foi pago. */
export function encargosDaBaixa(t: Pick<TituloParaBaixa, 'vencimento' | 'multaBp' | 'jurosMesBp'>, principal: number, data: string) {
  const r = calcularAtraso(principal, t.vencimento, data, { multaBp: t.multaBp, jurosMesBp: t.jurosMesBp });
  return { diasAtraso: r.diasAtraso, multa: r.multa, juros: r.juros, total: r.total };
}

/** Faz uma baixa (total ou parcial) do título e lança o dinheiro na conta. Tudo na transação de quem chama. */
export async function executarBaixa(c: PoolClient, a: Acesso, o: OpcoesBaixa) {
  const t = await lerTituloParaBaixa(c, o.tituloId, true);
  exigir(a, 'receber.baixar', t.empresaId);
  if (t.status === 'CANCELADO') throw new ConflictException('Este título está cancelado.');
  if (t.status === 'QUITADO') throw new ConflictException('Este título já está quitado.');
  const hoje = hojeSP();
  const data = o.data ?? hoje;
  if (data > hoje) throw erroCampo('data', 'A data do recebimento não pode ser futura.');
  if (data < t.dataLaudo) throw erroCampo('data', 'O recebimento não pode ser anterior à data do laudo.');
  const saldo = t.valorCentavos - t.pagoCentavos;
  const principal = o.principalCentavos ?? saldo;
  if (principal < 1 || principal > saldo) throw erroCampo('principalCentavos', `O valor precisa estar entre R$ 0,01 e o saldo do título (${formatarBRL(saldo)}).`);
  const enc = encargosDaBaixa(t, principal, data);

  let perdao = o.perdoarEncargos ? enc.multa + enc.juros : (o.perdaoCentavos ?? 0);
  if (perdao > enc.multa + enc.juros) throw erroCampo('perdaoCentavos', `O perdão não pode passar dos encargos (${formatarBRL(enc.multa + enc.juros)}).`);
  if (perdao > 0) {
    if (!o.motivo) throw erroCampo('motivo', 'Explique o motivo de perdoar multa e juros.');
    const perfil = perfilEm(a, t.empresaId)!;
    if (!temPermissao(perfil, 'juros.perdoar')) {
      exigir(a, 'juros.perdoar_ate_limite', t.empresaId);
      const lim = (await c.query('SELECT perdao_limite_centavos AS lim FROM empresa_config WHERE empresa_id = $1', [t.empresaId])).rows[0]?.lim ?? 5000;
      if (perdao > lim) throw new ForbiddenException(`O Financeiro perdoa até ${formatarBRL(lim)} por baixa. Acima disso, peça ao gerente.`);
    }
  }

  const formaId = o.formaPagamentoId ?? t.formaPagamentoId;
  const forma = (await c.query('SELECT status FROM forma_pagamento WHERE id = $1', [formaId])).rows[0];
  if (!forma || forma.status !== 'ATIVO') throw erroCampo('formaPagamentoId', 'Escolha uma forma de pagamento ativa.');
  if (!o.contaId) throw erroCampo('contaId', 'Escolha a conta em que o dinheiro entrou.');

  const recebido = principal + enc.multa + enc.juros - perdao;
  const lancId = await registrarLancamento(c, a, {
    empresaId: t.empresaId, contaId: o.contaId, data, valorCentavos: recebido, origem: 'BAIXA_RECEBER', planoContaId: t.contaReceitaId,
    descricao: `Recebimento do laudo nº ${t.numero} (${t.placa}) · ${t.cliente}`,
  });
  const baixa = (await c.query(
    `INSERT INTO baixa_receber (grupo_id, empresa_id, titulo_id, data, principal_centavos, multa_centavos, juros_centavos, perdao_centavos, forma_pagamento_id, conta_id, lancamento_id, lote_id, motivo, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, data::text AS data, principal_centavos AS "principalCentavos", multa_centavos AS "multaCentavos", juros_centavos AS "jurosCentavos", perdao_centavos AS "perdaoCentavos", recebido_centavos AS "recebidoCentavos"`,
    [a.grupoId, t.empresaId, t.id, data, principal, enc.multa, enc.juros, perdao, formaId, o.contaId, lancId, o.loteId ?? null, o.motivo ?? null, a.usuarioId])).rows[0];
  const novo = await recalcularTitulo(c, t.id);
  await auditar(c, a, { acao: 'receber.baixa', entidade: 'titulo_receber', entidadeId: t.id, empresaId: t.empresaId,
    depois: { laudo: t.numero, placa: t.placa, ...baixa, statusTitulo: novo.status, diasAtraso: enc.diasAtraso }, motivo: o.motivo });
  return { ...baixa, tituloStatus: novo.status, diasAtraso: enc.diasAtraso };
}

/** Estorna uma baixa: registro contrário (hoje) e lançamento contrário no caixa. */
export async function executarEstornoBaixa(c: PoolClient, a: Acesso, baixaId: string, motivo: string) {
  const b = (await c.query(
    `SELECT b.id, b.empresa_id AS "empresaId", b.titulo_id AS "tituloId", b.data::text AS data, b.principal_centavos AS principal, b.multa_centavos AS multa, b.juros_centavos AS juros,
            b.perdao_centavos AS perdao, b.forma_pagamento_id AS "formaId", b.conta_id AS "contaId", b.lancamento_id AS "lancamentoId", b.estorno_de AS "estornoDe"
       FROM baixa_receber b WHERE b.id = $1`, [baixaId])).rows[0];
  if (!b) throw new NotFoundException('Baixa não encontrada.');
  await c.query('SELECT 1 FROM titulo_receber WHERE id = $1 FOR UPDATE', [b.tituloId]);
  if (b.estornoDe) throw new ConflictException('Isto já é um estorno.');
  if ((await c.query('SELECT 1 FROM baixa_receber WHERE estorno_de = $1', [baixaId])).rows[0]) throw new ConflictException('Esta baixa já foi estornada.');
  const perfil = perfilEm(a, b.empresaId);
  if (!perfil) throw new ForbiddenException('Você não tem permissão para esta ação.');
  if (!temPermissao(perfil, 'receber.estornar')) {
    exigir(a, 'receber.estornar_periodo_aberto', b.empresaId);
    const fechadoAte = b.contaId ? await ultimoDiaFechado(c, b.contaId) : null;
    const mesFechado = (await c.query('SELECT periodo_fechado($1, $2) AS f', [b.empresaId, b.data])).rows[0].f;
    if (mesFechado || (fechadoAte && fechadoAte >= b.data)) throw new ForbiddenException('Esta baixa é de um período já fechado. Peça ao gerente para estornar.');
  }
  const hoje = hojeSP();
  if (b.lancamentoId) await estornarLancamento(c, a, b.lancamentoId, hoje, motivo);
  const est = (await c.query(
    `INSERT INTO baixa_receber (grupo_id, empresa_id, titulo_id, data, principal_centavos, multa_centavos, juros_centavos, perdao_centavos, forma_pagamento_id, conta_id, estorno_de, motivo, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [a.grupoId, b.empresaId, b.tituloId, hoje, -b.principal, -b.multa, -b.juros, -b.perdao, b.formaId, b.contaId, b.id, motivo, a.usuarioId])).rows[0];
  const novo = await recalcularTitulo(c, b.tituloId);
  await auditar(c, a, { acao: 'receber.baixa_estornada', entidade: 'titulo_receber', entidadeId: b.tituloId, empresaId: b.empresaId, depois: { baixaOriginal: b.id, estorno: est.id, statusTitulo: novo.status }, motivo });
  return { id: est.id, tituloStatus: novo.status };
}
