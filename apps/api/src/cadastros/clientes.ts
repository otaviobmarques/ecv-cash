import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { clienteSchema, diaAnterior, editarClienteSchema, precoSchema, temPermissao } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir, perfilAtivo } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { conflitoSe } from './comum';

const COLS = `id, tipo_pessoa AS "tipoPessoa", documento, nome, emails_cobranca AS "emailsCobranca", telefone, periodicidade, prazo_dias AS "prazoDias", multa_bp AS "multaBp", juros_mes_bp AS "jurosMesBp", status`;
const PRECO = `p.id, p.cliente_id AS "clienteId", p.servico_id AS "servicoId", s.nome AS servico, p.valor_centavos AS "valorCentavos", p.vigencia_ini AS "vigenciaIni", p.vigencia_fim AS "vigenciaFim", p.motivo`;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

@Injectable()
export class ClientesService {
  constructor(private readonly db: DbService) {}

  /** O Vistoriador vê só o nome do cliente (para escolher no lançamento). Documento e cobrança ficam com os demais. */
  async listar(a: Acesso, busca?: string) {
    const so = perfilAtivo(a) === 'VISTORIADOR';
    return this.db.tenant(contextoDb(a), async (c) =>
      (await c.query(
        so ? `SELECT id, nome FROM cliente WHERE status = 'ATIVO' AND ($1::text IS NULL OR lower(nome) LIKE '%' || lower($1) || '%') ORDER BY nome LIMIT 200`
           : `SELECT ${COLS} FROM cliente WHERE $1::text IS NULL OR lower(nome) LIKE '%' || lower($1) || '%' OR documento LIKE $1 || '%' ORDER BY nome LIMIT 500`,
        [busca?.trim() || null],
      )).rows,
    );
  }

  async detalhe(a: Acesso, id: string) {
    if (perfilAtivo(a) === 'VISTORIADOR') throw new ForbiddenException('Você não tem permissão para esta ação.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const cli = (await c.query(`SELECT ${COLS} FROM cliente WHERE id = $1`, [id])).rows[0];
      if (!cli) throw new NotFoundException('Cliente não encontrado.');
      const precos = (await c.query(`SELECT ${PRECO} FROM cliente_preco p JOIN servico s ON s.id = p.servico_id WHERE p.cliente_id = $1 ORDER BY s.nome, p.vigencia_ini DESC`, [id])).rows;
      return { ...cli, precos };
    });
  }

  async criar(a: Acesso, d: ReturnType<typeof clienteSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      try {
        const r = await c.query(
          `INSERT INTO cliente (grupo_id, tipo_pessoa, documento, nome, emails_cobranca, telefone, periodicidade, prazo_dias, multa_bp, juros_mes_bp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
          [a.grupoId, d.tipoPessoa, d.documento ?? null, d.nome, d.emailsCobranca, d.telefone ?? null, d.periodicidade, d.prazoDias, d.multaBp, d.jurosMesBp],
        );
        await auditar(c, a, { acao: 'cliente.criado', entidade: 'cliente', entidadeId: r.rows[0].id, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, 'Já existe um cliente com este CPF ou CNPJ.'); }
    });
  }

  async editar(a: Acesso, id: string, d: ReturnType<typeof editarClienteSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${COLS} FROM cliente WHERE id = $1`, [id])).rows[0];
      if (!antes) throw new NotFoundException('Cliente não encontrado.');
      const r = await c.query(
        `UPDATE cliente SET nome = coalesce($2, nome), emails_cobranca = coalesce($3, emails_cobranca), telefone = CASE WHEN $4::boolean THEN $5 ELSE telefone END,
                periodicidade = coalesce($6::periodicidade_fatura, periodicidade), prazo_dias = coalesce($7, prazo_dias), multa_bp = coalesce($8, multa_bp),
                juros_mes_bp = coalesce($9, juros_mes_bp), status = coalesce($10::status_cadastro, status) WHERE id = $1 RETURNING ${COLS}`,
        [id, d.nome ?? null, d.emailsCobranca ?? null, d.telefone !== undefined, d.telefone ?? null, d.periodicidade ?? null, d.prazoDias ?? null, d.multaBp ?? null, d.jurosMesBp ?? null, d.status ?? null],
      );
      await auditar(c, a, { acao: 'cliente.editado', entidade: 'cliente', entidadeId: id, antes, depois: r.rows[0] });
      return r.rows[0];
    });
  }

  /**
   * Cadastra o preço de um serviço para o cliente. O primeiro preço pode vir do Gerente ou do Administrativo.
   * Reajustar um preço que já existe é só do Administrativo, porque o novo valor vale em todas as lojas do grupo:
   * a vigência atual é encerrada na véspera e a nova começa na data escolhida.
   */
  async definirPreco(a: Acesso, clienteId: string, d: ReturnType<typeof precoSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const cli = (await c.query('SELECT status FROM cliente WHERE id = $1', [clienteId])).rows[0];
      if (!cli) throw new NotFoundException('Cliente não encontrado.');
      const srv = (await c.query('SELECT nome, status FROM servico WHERE id = $1', [d.servicoId])).rows[0];
      if (!srv) throw new NotFoundException('Serviço não encontrado.');
      if (cli.status !== 'ATIVO' || srv.status !== 'ATIVO') throw new ConflictException('Cliente e serviço precisam estar ativos.');

      const existentes = (await c.query(`SELECT id, valor_centavos AS "valorCentavos", vigencia_ini AS "vigenciaIni", vigencia_fim AS "vigenciaFim" FROM cliente_preco WHERE cliente_id = $1 AND servico_id = $2 ORDER BY vigencia_ini DESC`, [clienteId, d.servicoId])).rows;
      const ini = d.vigenciaIni ?? hoje();
      const reajuste = existentes.length > 0;
      if (reajuste) {
        exigir(a, 'preco.reajustar');
        if (!d.motivo) throw new UnprocessableEntityException({ mensagem: 'Explique o motivo do reajuste.', campos: { motivo: 'Informe o motivo do reajuste.' } });
        if (ini < hoje()) throw new UnprocessableEntityException({ mensagem: 'O reajuste não pode começar numa data que já passou.', campos: { vigenciaIni: 'Escolha hoje ou uma data futura.' } });
      } else {
        exigir(a, 'preco.cadastrar_primeiro');
      }
      const aberta = existentes.find((p) => p.vigenciaFim === null);
      const antes = aberta ?? null;
      if (aberta) {
        const iniAberta = new Date(aberta.vigenciaIni).toISOString().slice(0, 10);
        if (ini <= iniAberta) throw new ConflictException(`Já existe um preço em vigor desde ${iniAberta.split('-').reverse().join('/')}. Escolha uma data posterior.`);
        await c.query('UPDATE cliente_preco SET vigencia_fim = $2 WHERE id = $1', [aberta.id, diaAnterior(ini)]);
      }
      try {
        const r = await c.query(
          `INSERT INTO cliente_preco (grupo_id, cliente_id, servico_id, valor_centavos, vigencia_ini, motivo, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, cliente_id AS "clienteId", servico_id AS "servicoId", valor_centavos AS "valorCentavos", vigencia_ini AS "vigenciaIni", vigencia_fim AS "vigenciaFim", motivo`,
          [a.grupoId, clienteId, d.servicoId, d.valorCentavos, ini, d.motivo ?? null, a.usuarioId],
        );
        await auditar(c, a, { acao: reajuste ? 'preco.reajustado' : 'preco.cadastrado', entidade: 'cliente', entidadeId: clienteId, antes, depois: { servico: srv.nome, ...r.rows[0] }, motivo: d.motivo });
        return { ...r.rows[0], servico: srv.nome };
      } catch (e) {
        if ((e as { code?: string }).code === '23P01') throw new ConflictException('Já existe um preço para este cliente e serviço nesse período.');
        throw e;
      }
    });
  }

  /** Preço que vale numa data. É o que o lançamento de laudo usa. Sem preço: o Vistoriador digita o valor e o laudo fica marcado. */
  async vigente(a: Acesso, clienteId: string, servicoId: string, data: string) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = (await c.query(
        `SELECT valor_centavos AS "valorCentavos", vigencia_ini AS "vigenciaIni", vigencia_fim AS "vigenciaFim" FROM cliente_preco
          WHERE cliente_id = $1 AND servico_id = $2 AND vigencia_ini <= $3 AND (vigencia_fim IS NULL OR vigencia_fim >= $3)`,
        [clienteId, servicoId, data])).rows[0];
      return { preco: r ?? null };
    });
  }
}

const consultaVigente = z.object({ clienteId: z.string().uuid(), servicoId: z.string().uuid(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

@Controller()
export class ClientesController {
  constructor(private readonly svc: ClientesService) {}

  @Get('clientes') @Requer('cliente.ver')
  listar(@AcessoAtual() a: Acesso, @Query('busca') busca?: string) { return this.svc.listar(a, busca?.slice(0, 80)); }

  @Get('clientes/:id') @Requer('cliente.ver')
  detalhe(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.detalhe(a, id); }

  @Post('clientes')
  criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { exigir(a, 'cliente.editar'); return this.svc.criar(a, validar(clienteSchema, b)); }

  @Patch('clientes/:id')
  editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    exigir(a, 'cliente.editar');
    const dto = validar(editarClienteSchema, b);
    if (['periodicidade', 'prazoDias', 'multaBp', 'jurosMesBp'].some((k) => k in dto)) exigir(a, 'cliente_faturamento.editar');
    return this.svc.editar(a, id, dto);
  }

  /** A permissão (primeiro preço ou reajuste) é conferida no serviço, depois de saber se já existe preço. */
  @Post('clientes/:id/precos')
  preco(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    if (!temPermissao(perfilAtivo(a) ?? 'VISTORIADOR', 'preco.cadastrar_primeiro')) throw new ForbiddenException('Você não tem permissão para cadastrar preços.');
    return this.svc.definirPreco(a, id, validar(precoSchema, b));
  }

  @Get('precos/vigente') @Requer('preco.ver')
  vigente(@AcessoAtual() a: Acesso, @Query() q: unknown) {
    const f = validar(consultaVigente, q);
    return this.svc.vigente(a, f.clienteId, f.servicoId, f.data ?? hoje());
  }
}
