import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { z, ZodIssue } from 'zod';
import { contaFinanceiraSchema, decidirPedidoSchema, editarContaFinanceiraSchema, rejeitarPedidoSchema, validarContaFinanceira } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { Tentativas } from '../common/tentativas';
import { conferirSenha } from '../auth/senha';

const COLS = `id, empresa_id AS "empresaId", nome, tipo, saldo_inicial_centavos::bigint AS "saldoInicialCentavos", data_saldo_inicial AS "dataSaldoInicial", banco, agencia, conta,
              tipo_conta AS "tipoConta", titular, documento_titular AS "documentoTitular", pix_tipo AS "pixTipo", pix_chave AS "pixChave", exibir_na_fatura AS "exibirNaFatura", status`;
const COLUNA: Record<string, string> = {
  nome: 'nome', tipo: 'tipo', saldoInicialCentavos: 'saldo_inicial_centavos', dataSaldoInicial: 'data_saldo_inicial', banco: 'banco', agencia: 'agencia', conta: 'conta',
  tipoConta: 'tipo_conta', titular: 'titular', documentoTitular: 'documento_titular', pixTipo: 'pix_tipo', pixChave: 'pix_chave', exibirNaFatura: 'exibir_na_fatura', status: 'status',
};
const CAST: Record<string, string> = { tipo: '::tipo_conta_financeira', tipo_conta: '::tipo_conta_bancaria', pix_tipo: '::tipo_chave_pix', status: '::status_cadastro' };
/** O que o cliente lê na fatura para pagar. Mexer nisto, ou na visibilidade, exige confirmação do Administrativo. */
const SENSIVEIS = ['banco', 'agencia', 'conta', 'tipoConta', 'titular', 'documentoTitular', 'pixTipo', 'pixChave', 'exibirNaFatura'];
type Conta = Record<string, unknown> & { id: string; empresaId: string; exibirNaFatura: boolean; status: string };

const iguais = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function checarCompleta(merged: Record<string, unknown>) {
  const campos: Record<string, string> = {};
  validarContaFinanceira(merged as never, { addIssue: (i: ZodIssue) => { campos[String(i.path[0])] ??= i.message; } } as unknown as z.RefinementCtx);
  if (Object.keys(campos).length) throw new UnprocessableEntityException({ mensagem: 'Confira os campos da conta.', campos });
}

@Injectable()
export class ContasFinanceirasService {
  constructor(private readonly db: DbService, private readonly tentativas: Tentativas) {}

  /** Confere a senha de quem está confirmando uma mudança sensível. Erros contam para o bloqueio por tentativas. */
  private async confirmarSenha(c: PoolClient, a: Acesso, senha: string | undefined) {
    if (!senha) throw new UnprocessableEntityException({ mensagem: 'Digite sua senha para confirmar esta alteração.', campos: { senha: 'Digite sua senha para confirmar.' } });
    const u = (await c.query('SELECT senha_hash FROM usuario WHERE id = $1', [a.usuarioId])).rows[0];
    const chave = this.tentativas.chave('conf', a.email);
    await this.tentativas.exigirSemBloqueio(chave);
    const ok = await conferirSenha(u?.senha_hash ?? null, senha);
    await this.tentativas.registrar(chave, a.ip, ok);
    if (!ok) throw new ForbiddenException('Senha incorreta.');
  }

  private async aplicar(c: PoolClient, id: string, mudancas: Record<string, unknown>) {
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(mudancas)) {
      const col = COLUNA[k]; if (!col) continue;
      vals.push(v ?? null); sets.push(`${col} = $${vals.length}${CAST[col] ?? ''}`);
    }
    if (!sets.length) return (await c.query(`SELECT ${COLS} FROM conta_financeira WHERE id = $1`, [id])).rows[0];
    try { return (await c.query(`UPDATE conta_financeira SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`, vals)).rows[0]; }
    catch (e) {
      if ((e as { code?: string }).code === '23514') throw new UnprocessableEntityException({ mensagem: 'A conta ficaria incompleta para aparecer na fatura. Preencha banco, titular, documento e agência e conta (ou chave PIX).', campos: {} });
      throw e;
    }
  }

  listar(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT cf.id, cf.empresa_id AS "empresaId", cf.nome, cf.tipo, cf.saldo_inicial_centavos::bigint AS "saldoInicialCentavos", cf.data_saldo_inicial AS "dataSaldoInicial",
              cf.banco, cf.agencia, cf.conta, cf.tipo_conta AS "tipoConta", cf.titular, cf.documento_titular AS "documentoTitular", cf.pix_tipo AS "pixTipo",
              cf.pix_chave AS "pixChave", cf.exibir_na_fatura AS "exibirNaFatura", cf.status,
              (SELECT json_build_object('id', p.id, 'solicitadoPor', u.nome, 'criadoEm', p.criado_em) FROM conta_financeira_pedido p JOIN usuario u ON u.id = p.solicitado_por
                WHERE p.conta_id = cf.id AND p.status = 'PENDENTE') AS "pedidoPendente"
         FROM conta_financeira cf ORDER BY cf.empresa_id, cf.nome`)).rows);
  }

  async criar(a: Acesso, d: z.output<typeof contaFinanceiraSchema>) {
    exigir(a, 'conta_financeira.editar', d.empresaId);
    return this.db.tenant(contextoDb(a), async (c) => {
      if (!(await c.query(`SELECT 1 FROM empresa WHERE id = $1 AND status = 'ATIVO'`, [d.empresaId])).rows[0]) throw new BadRequestException('A empresa não existe ou está inativa.');
      const quer = d.exibirNaFatura;
      if (quer && a.rede) await this.confirmarSenha(c, a, d.senha);
      const gerente = quer && !a.rede; // pedido do Gerente: a conta nasce escondida e só aparece depois da aprovação
      const id = (await c.query(
        `INSERT INTO conta_financeira (grupo_id, empresa_id, nome, tipo, saldo_inicial_centavos, data_saldo_inicial, banco, agencia, conta, tipo_conta, titular, documento_titular, pix_tipo, pix_chave, exibir_na_fatura)
         VALUES ($1,$2,$3,$4,$5,coalesce($6::date, current_date),$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [a.grupoId, d.empresaId, d.nome, d.tipo, d.saldoInicialCentavos, d.dataSaldoInicial ?? null, d.banco ?? null, d.agencia ?? null, d.conta ?? null, d.tipoConta ?? null,
         d.titular ?? null, d.documentoTitular ?? null, d.pixTipo ?? null, d.pixChave ?? null, gerente ? false : quer])).rows[0].id;
      let pedido: { id: string } | null = null;
      if (gerente) {
        pedido = (await c.query(`INSERT INTO conta_financeira_pedido (grupo_id, empresa_id, conta_id, dados, solicitado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [a.grupoId, d.empresaId, id, JSON.stringify({ exibirNaFatura: true }), a.usuarioId])).rows[0];
      }
      const conta = (await c.query(`SELECT ${COLS} FROM conta_financeira WHERE id = $1`, [id])).rows[0];
      await auditar(c, a, { acao: 'conta_financeira.criada', entidade: 'conta_financeira', entidadeId: id, empresaId: d.empresaId, depois: conta });
      if (pedido) await auditar(c, a, { acao: 'conta_financeira.pedido_aberto', entidade: 'conta_financeira', entidadeId: id, empresaId: d.empresaId, depois: { pedidoId: pedido.id, exibirNaFatura: true } });
      return { conta, pedido };
    });
  }

  async editar(a: Acesso, id: string, d: z.output<typeof editarContaFinanceiraSchema>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const atual = (await c.query(`SELECT ${COLS} FROM conta_financeira WHERE id = $1`, [id])).rows[0] as Conta | undefined;
      if (!atual) throw new NotFoundException('Conta não encontrada.');
      exigir(a, 'conta_financeira.editar', atual.empresaId);
      const { senha, ...campos } = d;
      const mudancas = Object.fromEntries(Object.entries(campos).filter(([k, v]) => v !== undefined && !iguais(v, atual[k])));
      if (Object.keys(mudancas).length === 0) return { conta: atual, pedido: null };
      const merged = { ...atual, ...mudancas };
      checarCompleta(merged);
      const sensivel = Object.keys(mudancas).some((k) => SENSIVEIS.includes(k)) || (mudancas.status !== undefined && atual.exibirNaFatura);
      const gating = sensivel && (atual.exibirNaFatura || merged.exibirNaFatura);
      if (!gating) {
        const conta = await this.aplicar(c, id, mudancas);
        await auditar(c, a, { acao: 'conta_financeira.editada', entidade: 'conta_financeira', entidadeId: id, empresaId: atual.empresaId, antes: atual, depois: conta });
        return { conta, pedido: null };
      }
      if (a.rede) {
        await this.confirmarSenha(c, a, senha);
        const conta = await this.aplicar(c, id, mudancas);
        await auditar(c, a, { acao: 'conta_financeira.alteracao_confirmada', entidade: 'conta_financeira', entidadeId: id, empresaId: atual.empresaId, antes: atual, depois: conta });
        return { conta, pedido: null };
      }
      try {
        const pedido = (await c.query(`INSERT INTO conta_financeira_pedido (grupo_id, empresa_id, conta_id, dados, solicitado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [a.grupoId, atual.empresaId, id, JSON.stringify(mudancas), a.usuarioId])).rows[0];
        await auditar(c, a, { acao: 'conta_financeira.pedido_aberto', entidade: 'conta_financeira', entidadeId: id, empresaId: atual.empresaId, depois: { pedidoId: pedido.id, mudancas } });
        return { conta: atual, pedido };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe um pedido de alteração aguardando o Administrativo para esta conta.');
        throw e;
      }
    });
  }

  pedidos(a: Acesso, status?: string) {
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT p.id, p.empresa_id AS "empresaId", p.conta_id AS "contaId", cf.nome AS conta, p.dados, p.status, u.nome AS "solicitadoPor", p.criado_em AS "criadoEm",
              p.decidido_em AS "decididoEm", p.motivo_rejeicao AS "motivoRejeicao"
         FROM conta_financeira_pedido p JOIN usuario u ON u.id = p.solicitado_por LEFT JOIN conta_financeira cf ON cf.id = p.conta_id
        WHERE ($1::text IS NULL OR p.status = $1::status_pedido) ORDER BY p.criado_em DESC LIMIT 100`, [status ?? null])).rows);
  }

  async aprovar(a: Acesso, pedidoId: string, senha: string) {
    exigir(a, 'conta_financeira.aprovar_alteracao');
    return this.db.tenant(contextoDb(a), async (c) => {
      const p = (await c.query(`SELECT id, empresa_id AS "empresaId", conta_id AS "contaId", dados FROM conta_financeira_pedido WHERE id = $1 AND status = 'PENDENTE' FOR UPDATE`, [pedidoId])).rows[0];
      if (!p) throw new NotFoundException('Pedido não encontrado ou já decidido.');
      await this.confirmarSenha(c, a, senha);
      const antes = (await c.query(`SELECT ${COLS} FROM conta_financeira WHERE id = $1`, [p.contaId])).rows[0];
      checarCompleta({ ...antes, ...p.dados });
      const conta = await this.aplicar(c, p.contaId, p.dados);
      await c.query(`UPDATE conta_financeira_pedido SET status = 'APROVADO', decidido_por = $2, decidido_em = now() WHERE id = $1`, [pedidoId, a.usuarioId]);
      await auditar(c, a, { acao: 'conta_financeira.pedido_aprovado', entidade: 'conta_financeira', entidadeId: p.contaId, empresaId: p.empresaId, antes, depois: conta });
      return { conta };
    });
  }

  async rejeitar(a: Acesso, pedidoId: string, motivo: string) {
    exigir(a, 'conta_financeira.aprovar_alteracao');
    return this.db.tenant(contextoDb(a), async (c) => {
      const p = (await c.query(`UPDATE conta_financeira_pedido SET status = 'REJEITADO', decidido_por = $2, decidido_em = now(), motivo_rejeicao = $3
                                 WHERE id = $1 AND status = 'PENDENTE' RETURNING conta_id AS "contaId", empresa_id AS "empresaId"`, [pedidoId, a.usuarioId, motivo])).rows[0];
      if (!p) throw new NotFoundException('Pedido não encontrado ou já decidido.');
      await auditar(c, a, { acao: 'conta_financeira.pedido_rejeitado', entidade: 'conta_financeira', entidadeId: p.contaId, empresaId: p.empresaId, motivo });
      return { ok: true };
    });
  }
}

@Controller('contas-financeiras')
export class ContasFinanceirasController {
  constructor(private readonly svc: ContasFinanceirasService) {}

  @Get() @Requer('conta_financeira.ver')
  listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }

  @Post()
  criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { return this.svc.criar(a, validar(contaFinanceiraSchema, b)); }

  @Get('pedidos') @Requer('conta_financeira.ver')
  pedidos(@AcessoAtual() a: Acesso, @Query('status') status?: string) { return this.svc.pedidos(a, ['PENDENTE', 'APROVADO', 'REJEITADO'].includes(status ?? '') ? status : undefined); }

  @Post('pedidos/:id/aprovar')
  aprovar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.aprovar(a, id, validar(decidirPedidoSchema, b).senha); }

  @Post('pedidos/:id/rejeitar')
  rejeitar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.rejeitar(a, id, validar(rejeitarPedidoSchema, b).motivo); }

  @Patch(':id')
  editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.svc.editar(a, id, validar(editarContaFinanceiraSchema, b)); }
}
