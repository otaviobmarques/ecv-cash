import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { formatarBRL, type ajusteCaixaSchema, type fecharDiaSchema, type fecharPeriodoSchema, type transferenciaSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { estornarLancamento, hojeSP, registrarLancamento, saldoDaConta, ultimoDiaFechado } from './razao';

@Injectable()
export class CaixaService {
  constructor(private readonly db: DbService) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  private async conta(c: PoolClient, contaId: string) {
    const r = (await c.query(`SELECT id, empresa_id AS "empresaId", nome, tipo, status FROM conta_financeira WHERE id = $1`, [contaId])).rows[0];
    if (!r) throw new NotFoundException('Conta não encontrada.');
    return r as { id: string; empresaId: string; nome: string; tipo: string; status: string };
  }

  /** Contas da loja ativa com o saldo de hoje e o último dia fechado. */
  async contas(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'caixa.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const hoje = hojeSP();
      const rows = (await c.query(
        `SELECT cf.id, cf.nome, cf.tipo, cf.banco, cf.status,
                (CASE WHEN cf.data_saldo_inicial <= $2 THEN cf.saldo_inicial_centavos ELSE 0 END
                 + coalesce((SELECT sum(l.valor_centavos) FROM lancamento_financeiro l WHERE l.conta_id = cf.id AND l.data <= $2), 0))::bigint AS "saldoCentavos",
                (SELECT max(f.data)::text FROM fechamento_caixa f WHERE f.conta_id = cf.id AND f.status = 'FECHADO') AS "fechadoAte"
           FROM conta_financeira cf WHERE cf.empresa_id = $1 ORDER BY cf.status, cf.tipo, cf.nome`, [empresaId, hoje])).rows;
      return { hoje, contas: rows };
    });
  }

  async extrato(a: Acesso, contaId: string, de?: string, ate?: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const conta = await this.conta(c, contaId);
      exigir(a, 'caixa.ver', conta.empresaId);
      const fim = ate ?? hojeSP();
      const ini = de ?? fim.slice(0, 8) + '01';
      const abertura = ini === '0000-00-00' ? 0 : await saldoDaConta(c, contaId, new Date(Date.parse(ini) - 86_400_000).toISOString().slice(0, 10));
      const rows = (await c.query(
        `SELECT l.id, l.data::text AS data, l.valor_centavos AS "valorCentavos", l.origem, l.origem_id AS "origemId", l.descricao, l.estorno_de AS "estornoDe", l.motivo,
                pc.codigo || ' ' || pc.nome AS "planoConta", u.nome AS "criadoPor", l.criado_em AS "criadoEm",
                EXISTS (SELECT 1 FROM lancamento_financeiro e WHERE e.estorno_de = l.id) AS estornado
           FROM lancamento_financeiro l LEFT JOIN plano_conta pc ON pc.id = l.plano_conta_id LEFT JOIN usuario u ON u.id = l.criado_por
          WHERE l.conta_id = $1 AND l.data BETWEEN $2 AND $3 ORDER BY l.data, l.criado_em`, [contaId, ini, fim])).rows;
      // o saldo inicial da conta entra no extrato como a primeira linha do dia em que começa
      const si = (await c.query(`SELECT data_saldo_inicial::text AS data, saldo_inicial_centavos AS valor FROM conta_financeira WHERE id = $1`, [contaId])).rows[0];
      const linhas: Record<string, unknown>[] = [...rows];
      if (si.data >= ini && si.data <= fim && si.valor !== 0) {
        linhas.unshift({ id: 'saldo-inicial', data: si.data, valorCentavos: si.valor, origem: 'SALDO_INICIAL', descricao: 'Saldo inicial da conta', saldoInicial: true });
        linhas.sort((x, y) => String(x.data).localeCompare(String(y.data)) || (x.saldoInicial ? -1 : y.saldoInicial ? 1 : 0));
      }
      let saldo = abertura;
      const itens = linhas.map((r) => ({ ...r, saldoCentavos: (saldo += r.valorCentavos as number) }));
      const entradas = rows.filter((r) => r.valorCentavos > 0).reduce((s, r) => s + r.valorCentavos, 0);
      const saidas = rows.filter((r) => r.valorCentavos < 0).reduce((s, r) => s + r.valorCentavos, 0);
      return { conta, de: ini, ate: fim, aberturaCentavos: abertura, entradasCentavos: entradas, saidasCentavos: saidas, fechoCentavos: saldo, itens };
    });
  }

  async ajustar(a: Acesso, d: z.output<typeof ajusteCaixaSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const conta = await this.conta(c, d.contaId);
      exigir(a, 'caixa.ajustar', conta.empresaId);
      const data = d.data ?? hojeSP();
      if (data > hojeSP()) throw new UnprocessableEntityException({ mensagem: 'A data não pode ser futura.', campos: { data: 'A data não pode ser futura.' } });
      const id = await registrarLancamento(c, a, { empresaId: conta.empresaId, contaId: conta.id, data, valorCentavos: d.valorCentavos, origem: 'AJUSTE', planoContaId: d.planoContaId ?? null, descricao: d.descricao, motivo: d.motivo });
      await auditar(c, a, { acao: 'caixa.ajuste', entidade: 'lancamento_financeiro', entidadeId: id, empresaId: conta.empresaId, depois: { conta: conta.nome, data, valorCentavos: d.valorCentavos, descricao: d.descricao }, motivo: d.motivo });
      return { id };
    });
  }

  async transferir(a: Acesso, d: z.output<typeof transferenciaSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const o = await this.conta(c, d.contaOrigemId); const dest = await this.conta(c, d.contaDestinoId);
      exigir(a, 'transferencia.criar', o.empresaId);
      if (o.empresaId !== dest.empresaId) exigir(a, 'transferencia.intercompany', o.empresaId);
      const data = d.data ?? hojeSP();
      if (data > hojeSP()) throw new UnprocessableEntityException({ mensagem: 'A data não pode ser futura.', campos: { data: 'A data não pode ser futura.' } });
      const saldo = await saldoDaConta(c, o.id, data);
      if (o.tipo === 'CAIXA' && saldo < d.valorCentavos) throw new ConflictException(`O caixa "${o.nome}" tem ${formatarBRL(saldo)} nesta data: não dá para tirar ${formatarBRL(d.valorCentavos)}.`);
      const id = (await c.query(
        `INSERT INTO transferencia (grupo_id, empresa_origem_id, conta_origem_id, empresa_destino_id, conta_destino_id, data, valor_centavos, descricao, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [a.grupoId, o.empresaId, o.id, dest.empresaId, dest.id, data, d.valorCentavos, d.descricao, a.usuarioId])).rows[0].id;
      await registrarLancamento(c, a, { empresaId: o.empresaId, contaId: o.id, data, valorCentavos: -d.valorCentavos, origem: 'TRANSFERENCIA', origemId: id, descricao: `Transferência para ${dest.nome}: ${d.descricao}` });
      await registrarLancamento(c, a, { empresaId: dest.empresaId, contaId: dest.id, data, valorCentavos: d.valorCentavos, origem: 'TRANSFERENCIA', origemId: id, descricao: `Transferência de ${o.nome}: ${d.descricao}` });
      await auditar(c, a, { acao: o.empresaId === dest.empresaId ? 'caixa.transferencia' : 'caixa.transferencia_intercompany', entidade: 'transferencia', entidadeId: id, empresaId: o.empresaId,
        depois: { origem: o.nome, destino: dest.nome, data, valorCentavos: d.valorCentavos, descricao: d.descricao } });
      return { id };
    });
  }

  /** Estorno de ajuste ou de transferência: cria os lançamentos contrários. Baixas e pagamentos se estornam nos próprios módulos. */
  async estornar(a: Acesso, lancamentoId: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const l = (await c.query(`SELECT id, empresa_id AS "empresaId", origem, origem_id AS "origemId" FROM lancamento_financeiro WHERE id = $1`, [lancamentoId])).rows[0];
      if (!l) throw new NotFoundException('Lançamento não encontrado.');
      if (l.origem !== 'AJUSTE' && l.origem !== 'TRANSFERENCIA') throw new ConflictException('Este lançamento vem de uma baixa ou pagamento: estorne-o pela própria tela de Receber ou Pagar.');
      exigir(a, 'caixa.ajustar', l.empresaId);
      const hoje = hojeSP();
      const todos = l.origem === 'TRANSFERENCIA' ? (await c.query(`SELECT id FROM lancamento_financeiro WHERE origem = 'TRANSFERENCIA' AND origem_id = $1 AND estorno_de IS NULL`, [l.origemId])).rows : [{ id: l.id }];
      if (l.origem === 'TRANSFERENCIA') exigir(a, 'transferencia.intercompany', l.empresaId); // desfazer transferência mexe nas duas pontas
      for (const t of todos) {
        if ((await c.query('SELECT 1 FROM lancamento_financeiro WHERE estorno_de = $1', [t.id])).rows[0]) throw new ConflictException('Este lançamento já foi estornado.');
        await estornarLancamento(c, a, t.id, hoje, motivo);
      }
      await auditar(c, a, { acao: 'caixa.estorno', entidade: 'lancamento_financeiro', entidadeId: lancamentoId, empresaId: l.empresaId, motivo });
      return { estornados: todos.length };
    });
  }

  // ---- fechamento diário ----
  async fecharDia(a: Acesso, d: z.output<typeof fecharDiaSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const conta = await this.conta(c, d.contaId);
      exigir(a, 'caixa.fechar', conta.empresaId);
      const hoje = hojeSP();
      if (d.data > hoje) throw new UnprocessableEntityException({ mensagem: 'Não dá para fechar um dia que ainda não aconteceu.', campos: { data: 'Escolha hoje ou um dia anterior.' } });
      const ultimo = await ultimoDiaFechado(c, conta.id);
      if (ultimo && d.data <= ultimo) throw new ConflictException(`O caixa desta conta já está fechado até ${ultimo.split('-').reverse().join('/')}.`);
      const sistema = await saldoDaConta(c, conta.id, d.data);
      const diferenca = d.saldoContadoCentavos - sistema;
      if (diferenca !== 0 && !d.observacao) {
        throw new UnprocessableEntityException({ mensagem: `O saldo contado difere do sistema em ${formatarBRL(Math.abs(diferenca))}. Explique a diferença na observação para fechar.`, campos: { observacao: 'Explique a diferença.' }, saldoSistemaCentavos: sistema, diferencaCentavos: diferenca });
      }
      const id = (await c.query(
        `INSERT INTO fechamento_caixa (grupo_id, empresa_id, conta_id, data, saldo_sistema_centavos, saldo_contado_centavos, observacao, fechado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (conta_id, data) DO UPDATE SET status = 'FECHADO', saldo_sistema_centavos = EXCLUDED.saldo_sistema_centavos, saldo_contado_centavos = EXCLUDED.saldo_contado_centavos,
           observacao = EXCLUDED.observacao, fechado_por = EXCLUDED.fechado_por, fechado_em = now(), reaberto_por = NULL, reaberto_em = NULL, motivo_reabertura = NULL
         RETURNING id`,
        [a.grupoId, conta.empresaId, conta.id, d.data, sistema, d.saldoContadoCentavos, d.observacao ?? null, a.usuarioId])).rows[0].id;
      await auditar(c, a, { acao: 'caixa.dia_fechado', entidade: 'fechamento_caixa', entidadeId: id, empresaId: conta.empresaId, depois: { conta: conta.nome, data: d.data, saldoSistemaCentavos: sistema, saldoContadoCentavos: d.saldoContadoCentavos, diferencaCentavos: diferenca }, motivo: d.observacao });
      return { id, saldoSistemaCentavos: sistema, diferencaCentavos: diferenca };
    });
  }

  async reabrirDia(a: Acesso, fechamentoId: string, motivo: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = (await c.query(`SELECT id, conta_id AS "contaId", empresa_id AS "empresaId", data::text AS data, status FROM fechamento_caixa WHERE id = $1`, [fechamentoId])).rows[0];
      if (!f) throw new NotFoundException('Fechamento não encontrado.');
      exigir(a, 'caixa.reabrir_dia', f.empresaId);
      if (f.status !== 'FECHADO') throw new ConflictException('Este dia já está reaberto.');
      if (f.data !== (await ultimoDiaFechado(c, f.contaId))) throw new ConflictException('Só dá para reabrir o último dia fechado da conta. Reabra os mais recentes primeiro.');
      if ((await c.query('SELECT periodo_fechado($1, $2) AS f', [f.empresaId, f.data])).rows[0].f) throw new ConflictException('O mês deste dia está fechado. O Administrativo precisa reabrir o período primeiro.');
      await c.query(`UPDATE fechamento_caixa SET status = 'REABERTO', reaberto_por = $2, reaberto_em = now(), motivo_reabertura = $3 WHERE id = $1`, [f.id, a.usuarioId, motivo]);
      await auditar(c, a, { acao: 'caixa.dia_reaberto', entidade: 'fechamento_caixa', entidadeId: f.id, empresaId: f.empresaId, depois: { data: f.data }, motivo });
      return { ok: true };
    });
  }

  async fechamentos(a: Acesso, contaId?: string) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'caixa.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const dias = (await c.query(
        `SELECT f.id, f.conta_id AS "contaId", cf.nome AS conta, f.data::text AS data, f.saldo_sistema_centavos AS "saldoSistemaCentavos", f.saldo_contado_centavos AS "saldoContadoCentavos",
                f.diferenca_centavos AS "diferencaCentavos", f.observacao, f.status, u.nome AS "fechadoPor", f.fechado_em AS "fechadoEm", f.motivo_reabertura AS "motivoReabertura"
           FROM fechamento_caixa f JOIN conta_financeira cf ON cf.id = f.conta_id LEFT JOIN usuario u ON u.id = f.fechado_por
          WHERE f.empresa_id = $1 AND ($2::uuid IS NULL OR f.conta_id = $2) ORDER BY f.data DESC, cf.nome LIMIT 90`, [empresaId, contaId ?? null])).rows;
      const meses = (await c.query(
        `SELECT p.id, to_char(p.mes, 'YYYY-MM') AS mes, p.status, u.nome AS "fechadoPor", p.fechado_em AS "fechadoEm", p.motivo_reabertura AS "motivoReabertura"
           FROM fechamento_periodo p LEFT JOIN usuario u ON u.id = p.fechado_por WHERE p.empresa_id = $1 ORDER BY p.mes DESC LIMIT 36`, [empresaId])).rows;
      return { dias, meses };
    });
  }

  // ---- fechamento mensal ----
  async fecharPeriodo(a: Acesso, d: z.output<typeof fecharPeriodoSchema>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'periodo.fechar', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      const mes = `${d.mes}-01`;
      const fimDoMes = (await c.query(`SELECT (date_trunc('month', $1::date) + interval '1 month' - interval '1 day')::date::text AS f`, [mes])).rows[0].f as string;
      if (fimDoMes >= hojeSP()) throw new UnprocessableEntityException({ mensagem: 'O mês ainda não terminou. Só é possível fechar meses já encerrados.', campos: { mes: 'Escolha um mês já encerrado.' } });
      // todas as contas ativas precisam estar com o caixa fechado até o fim do mês
      const abertas = (await c.query(
        `SELECT cf.nome FROM conta_financeira cf
          WHERE cf.empresa_id = $1 AND cf.status = 'ATIVO' AND cf.data_saldo_inicial <= $2
            AND coalesce((SELECT max(f.data) FROM fechamento_caixa f WHERE f.conta_id = cf.id AND f.status = 'FECHADO'), '0001-01-01') < $2::date ORDER BY cf.nome`, [empresaId, fimDoMes])).rows;
      if (abertas.length) throw new ConflictException(`Feche o caixa até ${fimDoMes.split('-').reverse().join('/')} nas contas: ${abertas.map((x) => x.nome).join(', ')}.`);
      const id = (await c.query(
        `INSERT INTO fechamento_periodo (grupo_id, empresa_id, mes, fechado_por) VALUES ($1,$2,$3,$4)
         ON CONFLICT (empresa_id, mes) DO UPDATE SET status = 'FECHADO', fechado_por = EXCLUDED.fechado_por, fechado_em = now(), reaberto_por = NULL, reaberto_em = NULL, motivo_reabertura = NULL
          WHERE fechamento_periodo.status = 'REABERTO' RETURNING id`, [a.grupoId, empresaId, mes, a.usuarioId])).rows[0]?.id;
      if (!id) throw new ConflictException('Este mês já está fechado.');
      await auditar(c, a, { acao: 'periodo.fechado', entidade: 'fechamento_periodo', entidadeId: id, empresaId, depois: { mes: d.mes } });
      return { id };
    });
  }

  async reabrirPeriodo(a: Acesso, mes: string, motivo: string) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'periodo.reabrir', empresaId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new BadRequestException('Use o mês no formato AAAA-MM.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query(`UPDATE fechamento_periodo SET status = 'REABERTO', reaberto_por = $3, reaberto_em = now(), motivo_reabertura = $4 WHERE empresa_id = $1 AND mes = $2 AND status = 'FECHADO' RETURNING id`, [empresaId, `${mes}-01`, a.usuarioId, motivo])).rows[0];
      if (!r) throw new NotFoundException('Este mês não está fechado.');
      await auditar(c, a, { acao: 'periodo.reaberto', entidade: 'fechamento_periodo', entidadeId: r.id, empresaId, depois: { mes }, motivo });
      return { ok: true };
    });
  }
}
