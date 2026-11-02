import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { z } from 'zod';
import type { compensarChequeSchema, depositarChequeSchema, devolverChequeSchema, filtroChequeSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { estornarLancamento, hojeSP, registrarLancamento } from '../caixa/razao';
import { executarEstornoBaixa } from '../receber/baixa';

const erroCampo = (campo: string, mensagem: string) => new UnprocessableEntityException({ mensagem, campos: { [campo]: mensagem } });
const br = (iso: string) => iso.split('-').reverse().join('/');

@Injectable()
export class ChequesService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  async listar(a: Acesso, f: z.output<typeof filtroChequeSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'cheque.controlar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const onde = ['k.empresa_id = $1']; const p: unknown[] = [empresaId];
      if (f.situacao === 'receber') onde.push(`k.status IN ('RECEBIDO','DEPOSITADO')`);
      if (f.situacao === 'recebidos') onde.push(`k.status = 'RECEBIDO'`);
      if (f.situacao === 'depositados') onde.push(`k.status = 'DEPOSITADO'`);
      if (f.situacao === 'compensados') onde.push(`k.status = 'COMPENSADO'`);
      if (f.situacao === 'devolvidos') onde.push(`k.status = 'DEVOLVIDO'`);
      if (f.de) { p.push(f.de); onde.push(`k.bom_para >= $${p.length}`); }
      if (f.ate) { p.push(f.ate); onde.push(`k.bom_para <= $${p.length}`); }
      p.push(f.limite);
      const itens = (await c.query(
        `SELECT k.id, k.numero, k.banco, k.emitente, k.bom_para::text AS "bomPara", k.valor_centavos AS "valorCentavos", k.status, cf.nome AS "contaDeposito", k.depositado_em::text AS "depositadoEm",
                k.compensado_em::text AS "compensadoEm", k.devolvido_em::text AS "devolvidoEm", k.motivo_devolucao AS "motivoDevolucao", l.numero_interno::int AS laudo, l.placa, cl.nome AS cliente
           FROM cheque k JOIN baixa_receber b ON b.id = k.baixa_id JOIN titulo_receber t ON t.id = b.titulo_id JOIN laudo l ON l.id = t.laudo_id JOIN cliente cl ON cl.id = t.cliente_id LEFT JOIN conta_financeira cf ON cf.id = k.conta_deposito_id
          WHERE ${onde.join(' AND ')} ORDER BY k.bom_para, k.criado_em LIMIT $${p.length}`, p)).rows;
      const resumo = (await c.query(
        `SELECT coalesce(sum(valor_centavos) FILTER (WHERE status = 'RECEBIDO'), 0)::bigint AS "naMaoCentavos", coalesce(sum(valor_centavos) FILTER (WHERE status = 'DEPOSITADO'), 0)::bigint AS "depositadoCentavos",
                count(*) FILTER (WHERE status = 'RECEBIDO' AND bom_para <= $2)::int AS "paraDepositar" FROM cheque WHERE empresa_id = $1`, [empresaId, hoje])).rows[0];
      return { itens: itens.map((i) => ({ ...i, podeDepositar: i.status === 'RECEBIDO' && i.bomPara <= hoje })), resumo, hoje };
    });
  }

  private async ler(c: import('pg').PoolClient, id: string) {
    const k = (await c.query(`SELECT id, empresa_id AS "empresaId", baixa_id AS "baixaId", numero, status, bom_para::text AS "bomPara", valor_centavos AS valor, conta_deposito_id AS "contaDepositoId", lancamento_id AS "lancamentoId", depositado_em::text AS "depositadoEm" FROM cheque WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!k) throw new NotFoundException('Cheque não encontrado.');
    return k as { id: string; empresaId: string; baixaId: string; numero: string; status: string; bomPara: string; valor: number; contaDepositoId: string | null; lancamentoId: string | null; depositadoEm: string | null };
  }

  async depositar(a: Acesso, id: string, d: z.output<typeof depositarChequeSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const k = await this.ler(c, id);
      exigir(a, 'cheque.controlar', k.empresaId);
      if (k.status !== 'RECEBIDO') throw new ConflictException('Só cheque recebido pode ser depositado.');
      const hoje = hojeSP(); const data = d.data ?? hoje;
      if (data > hoje) throw erroCampo('data', 'A data do depósito não pode ser futura.');
      if (data < k.bomPara) throw new ConflictException(`Este cheque é bom para ${br(k.bomPara)}. Não deposite antes.`);
      if (!(await c.query(`SELECT 1 FROM conta_financeira WHERE id = $1 AND empresa_id = $2 AND tipo = 'BANCO' AND status = 'ATIVO'`, [d.contaId, k.empresaId])).rows[0]) throw erroCampo('contaId', 'Escolha uma conta bancária ativa desta loja.');
      await c.query(`UPDATE cheque SET status = 'DEPOSITADO', conta_deposito_id = $2, depositado_em = $3, atualizado_por = $4 WHERE id = $1`, [id, d.contaId, data, a.usuarioId]);
      await auditar(c, a, { acao: 'cheque.depositado', entidade: 'cheque', entidadeId: id, empresaId: k.empresaId, depois: { numero: k.numero, data } });
      return { ok: true };
    });
  }

  /** Compensou: só agora o dinheiro entra na conta do depósito. */
  async compensar(a: Acesso, id: string, d: z.output<typeof compensarChequeSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const k = await this.ler(c, id);
      exigir(a, 'cheque.controlar', k.empresaId);
      if (k.status !== 'DEPOSITADO') throw new ConflictException('Só cheque depositado pode ser compensado.');
      const hoje = hojeSP(); const data = d.data ?? hoje;
      if (data > hoje) throw erroCampo('data', 'A data da compensação não pode ser futura.');
      if (data < k.depositadoEm!) throw erroCampo('data', 'A compensação não pode ser antes do depósito.');
      const lanc = await registrarLancamento(c, a, { empresaId: k.empresaId, contaId: k.contaDepositoId!, data, valorCentavos: k.valor, origem: 'CHEQUE', origemId: id, descricao: `Cheque nº ${k.numero} compensado` });
      await c.query(`UPDATE cheque SET status = 'COMPENSADO', compensado_em = $2, lancamento_id = $3, atualizado_por = $4 WHERE id = $1`, [id, data, lanc, a.usuarioId]);
      await auditar(c, a, { acao: 'cheque.compensado', entidade: 'cheque', entidadeId: id, empresaId: k.empresaId, depois: { numero: k.numero, data, valorCentavos: k.valor } });
      return { ok: true };
    });
  }

  /** Cheque devolvido: a baixa é estornada e o título volta a ficar em aberto para cobrar de novo. */
  async devolver(a: Acesso, id: string, d: z.output<typeof devolverChequeSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const k = await this.ler(c, id);
      exigir(a, 'cheque.controlar', k.empresaId);
      if (!['RECEBIDO', 'DEPOSITADO', 'COMPENSADO'].includes(k.status)) throw new ConflictException('Este cheque já foi devolvido ou cancelado.');
      const hoje = hojeSP(); const data = d.data ?? hoje;
      if (data > hoje) throw erroCampo('data', 'A data da devolução não pode ser futura.');
      if (k.status === 'COMPENSADO' && k.lancamentoId) await estornarLancamento(c, a, k.lancamentoId, hoje, `Cheque nº ${k.numero} devolvido: ${d.motivo}`);
      await c.query(`UPDATE cheque SET status = 'DEVOLVIDO', devolvido_em = $2, motivo_devolucao = $3, atualizado_por = $4 WHERE id = $1`, [id, data, d.motivo, a.usuarioId]);
      const est = await executarEstornoBaixa(c, a, k.baixaId, `Cheque nº ${k.numero} devolvido: ${d.motivo}`, { semPermissao: true });
      await auditar(c, a, { acao: 'cheque.devolvido', entidade: 'cheque', entidadeId: id, empresaId: k.empresaId, depois: { numero: k.numero, data, statusTitulo: est.tituloStatus }, motivo: d.motivo });
      return { ok: true, tituloStatus: est.tituloStatus };
    });
  }
}
