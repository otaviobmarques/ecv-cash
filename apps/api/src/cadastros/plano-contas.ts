import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UnprocessableEntityException } from '@nestjs/common';
import { editarPlanoContaSchema, planoContaSchema } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { AcessoAtual, Requer } from '../common/decorators';
import { validar } from '../common/zod';
import { conflitoSe } from './comum';
import { semearPadroes } from './padroes';

const COLS = `id, codigo, nome, tipo, pai_id AS "paiId", aceita_lancamento AS "aceitaLancamento", status`;
const ORDEM = `ORDER BY string_to_array(codigo, '.')::int[]`;

@Injectable()
export class PlanoContasService {
  constructor(private readonly db: DbService) {}

  listar(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(`SELECT ${COLS} FROM plano_conta ${ORDEM}`)).rows);
  }

  async criar(a: Acesso, dto: ReturnType<typeof planoContaSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const paiCodigo = dto.codigo.includes('.') ? dto.codigo.slice(0, dto.codigo.lastIndexOf('.')) : null;
      let paiId: string | null = null;
      if (paiCodigo) {
        const pai = (await c.query('SELECT id, tipo, aceita_lancamento FROM plano_conta WHERE codigo = $1', [paiCodigo])).rows[0];
        if (!pai) throw new UnprocessableEntityException({ mensagem: `Cadastre primeiro a conta ${paiCodigo}.`, campos: { codigo: `A conta ${paiCodigo} ainda não existe.` } });
        if (pai.tipo !== dto.tipo) throw new UnprocessableEntityException({ mensagem: 'O tipo precisa ser o mesmo da conta pai.', campos: { tipo: `A conta ${paiCodigo} é do tipo ${pai.tipo}.` } });
        paiId = pai.id;
        if (pai.aceita_lancamento) await c.query('UPDATE plano_conta SET aceita_lancamento = false WHERE id = $1', [pai.id]); // quem tem filha só agrupa
      }
      try {
        const r = await c.query(
          `INSERT INTO plano_conta (grupo_id, codigo, nome, tipo, pai_id, aceita_lancamento) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
          [a.grupoId, dto.codigo, dto.nome, dto.tipo, paiId, dto.aceitaLancamento],
        );
        await auditar(c, a, { acao: 'plano_conta.criada', entidade: 'plano_conta', entidadeId: r.rows[0].id, depois: r.rows[0] });
        return r.rows[0];
      } catch (e) { return conflitoSe(e, `Já existe a conta ${dto.codigo}.`); }
    });
  }

  async editar(a: Acesso, id: string, dto: ReturnType<typeof editarPlanoContaSchema.parse>) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query(`SELECT ${COLS} FROM plano_conta WHERE id = $1`, [id])).rows[0];
      if (!antes) throw new NotFoundException('Conta não encontrada.');
      if (dto.status === 'INATIVO' && antes.status === 'ATIVO') {
        const filhas = Number((await c.query(`SELECT count(*) AS n FROM plano_conta WHERE pai_id = $1 AND status = 'ATIVO'`, [id])).rows[0].n);
        if (filhas > 0) throw new ConflictException('Esta conta tem subcontas ativas. Inative as subcontas antes.');
        const uso = Number((await c.query(`SELECT (SELECT count(*) FROM servico WHERE conta_receita_id = $1 AND status = 'ATIVO') + (SELECT count(*) FROM fornecedor WHERE conta_padrao_id = $1 AND status = 'ATIVO') AS n`, [id])).rows[0].n);
        if (uso > 0) throw new ConflictException('Esta conta está em uso por serviços ou fornecedores ativos. Troque a conta deles antes.');
      }
      const r = await c.query(
        `UPDATE plano_conta SET nome = coalesce($2, nome), aceita_lancamento = coalesce($3, aceita_lancamento), status = coalesce($4::status_cadastro, status) WHERE id = $1 RETURNING ${COLS}`,
        [id, dto.nome ?? null, dto.aceitaLancamento ?? null, dto.status ?? null],
      );
      await auditar(c, a, { acao: 'plano_conta.editada', entidade: 'plano_conta', entidadeId: id, antes, depois: r.rows[0] });
      return r.rows[0];
    });
  }

  /** Carrega o plano e as formas de pagamento padrão num grupo que ainda não os tem. */
  async carregarPadroes(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const r = await semearPadroes(c, a.grupoId);
      if (r.plano + r.formas === 0) throw new BadRequestException('Este grupo já tem plano de contas e formas de pagamento.');
      await auditar(c, a, { acao: 'padroes.carregados', entidade: 'grupo', entidadeId: a.grupoId, depois: r });
      return r;
    });
  }
}

@Controller()
export class PlanoContasController {
  constructor(private readonly svc: PlanoContasService) {}

  @Get('plano-contas') @Requer('plano_contas.ver')
  listar(@AcessoAtual() a: Acesso) { return this.svc.listar(a); }

  @Post('plano-contas')
  criar(@AcessoAtual() a: Acesso, @Body() b: unknown) { exigir(a, 'plano_contas.editar'); return this.svc.criar(a, validar(planoContaSchema, b)); }

  @Patch('plano-contas/:id')
  editar(@AcessoAtual() a: Acesso, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { exigir(a, 'plano_contas.editar'); return this.svc.editar(a, id, validar(editarPlanoContaSchema, b)); }

  @Post('cadastros/padroes')
  padroes(@AcessoAtual() a: Acesso) { exigir(a, 'plano_contas.editar'); return this.svc.carregarPadroes(a); }
}
