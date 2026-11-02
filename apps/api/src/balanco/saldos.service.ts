import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { z } from 'zod';
import { temPermissao, type saldoManualSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilEm } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { CODIGOS_AUTOMATICOS } from '../relatorios/balanco';

@Injectable()
export class SaldosService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  async listar(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    const perfil = perfilEm(a, empresaId);
    if (!perfil || !temPermissao(perfil, 'relatorio.dre_balanco')) throw new ForbiddenException('Você não tem permissão para esta ação.');
    return this.db.tenant(contextoDb(a), async (c) => ({
      automaticas: CODIGOS_AUTOMATICOS,
      saldos: (await c.query(
        `SELECT s.id, s.plano_conta_id AS "planoContaId", pc.codigo, pc.nome, pc.tipo, s.data_base::text AS "dataBase", s.valor_centavos AS "valorCentavos", s.observacao, s.atualizado_em AS "atualizadoEm"
           FROM saldo_patrimonial_manual s JOIN plano_conta pc ON pc.id = s.plano_conta_id WHERE s.empresa_id = $1 ORDER BY pc.codigo, s.data_base DESC`, [empresaId])).rows,
    }));
  }

  /** Informa (ou corrige) o saldo de uma conta numa data-base. Fica na auditoria com o valor anterior. */
  async salvar(a: Acesso, d: z.output<typeof saldoManualSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'balanco.editar', empresaId);
    if (d.dataBase > hojeSP()) throw new UnprocessableEntityException({ mensagem: 'A data-base não pode ser futura.', campos: { dataBase: 'Escolha uma data até hoje.' } });
    return this.db.tenant(contextoDb(a), async (c) => {
      const pc = (await c.query('SELECT codigo, nome, tipo, status, aceita_lancamento AS ok FROM plano_conta WHERE id = $1', [d.planoContaId])).rows[0];
      if (!pc || pc.status !== 'ATIVO' || !pc.ok) throw new UnprocessableEntityException({ mensagem: 'Escolha uma conta do plano que aceite lançamento.', campos: { planoContaId: 'Conta inválida.' } });
      if (!['ATIVO', 'PASSIVO', 'PATRIMONIO'].includes(pc.tipo)) throw new UnprocessableEntityException({ mensagem: 'O balanço só usa contas de ativo, passivo ou patrimônio líquido.', campos: { planoContaId: 'Escolha uma conta de ativo, passivo ou patrimônio.' } });
      if (CODIGOS_AUTOMATICOS.includes(pc.codigo)) throw new ConflictException(`A conta ${pc.codigo} ${pc.nome} é calculada pelo sistema (caixa, contas a receber e a pagar). Escolha outra.`);
      const antes = (await c.query('SELECT valor_centavos AS v FROM saldo_patrimonial_manual WHERE empresa_id = $1 AND plano_conta_id = $2 AND data_base = $3', [empresaId, d.planoContaId, d.dataBase])).rows[0];
      const id = (await c.query(
        `INSERT INTO saldo_patrimonial_manual (grupo_id, empresa_id, plano_conta_id, data_base, valor_centavos, observacao, atualizado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (empresa_id, plano_conta_id, data_base) DO UPDATE SET valor_centavos = EXCLUDED.valor_centavos, observacao = EXCLUDED.observacao, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now() RETURNING id`,
        [a.grupoId, empresaId, d.planoContaId, d.dataBase, d.valorCentavos, d.observacao ?? null, a.usuarioId])).rows[0].id;
      await auditar(c, a, { acao: 'balanco.saldo_informado', entidade: 'saldo_patrimonial_manual', entidadeId: id, empresaId, antes: antes ? { valorCentavos: antes.v } : undefined, depois: { conta: `${pc.codigo} ${pc.nome}`, dataBase: d.dataBase, valorCentavos: d.valorCentavos }, motivo: d.observacao });
      return { id };
    });
  }
}
