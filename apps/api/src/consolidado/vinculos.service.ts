import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb } from '../common/acesso';
import { auditar } from '../common/auditoria';

@Injectable()
export class VinculosService {
  constructor(private readonly db: DbService) {}

  private soAdministrativo(a: Acesso) {
    if (!a.rede) throw new ForbiddenException('Só o Administrativo diz quais clientes e fornecedores são empresas do próprio grupo.');
  }

  async listar(a: Acesso) {
    this.soAdministrativo(a);
    return this.db.tenant(contextoDb(a), async (c) => ({
      empresas: (await c.query(`SELECT id, nome_fantasia AS nome FROM empresa WHERE status = 'ATIVO' ORDER BY nome_fantasia`)).rows,
      clientes: (await c.query(`SELECT id, nome, tipo_pessoa AS "tipoPessoa", empresa_vinculada_id AS "empresaVinculadaId" FROM cliente WHERE status = 'ATIVO' OR empresa_vinculada_id IS NOT NULL ORDER BY nome LIMIT 1000`)).rows,
      fornecedores: (await c.query(`SELECT id, nome, tipo, empresa_vinculada_id AS "empresaVinculadaId" FROM fornecedor WHERE status = 'ATIVO' OR empresa_vinculada_id IS NOT NULL ORDER BY nome LIMIT 1000`)).rows,
    }));
  }

  /** Marca (ou desmarca) um cliente ou fornecedor como outra empresa do grupo. Muda o consolidado de todos os períodos, porque a eliminação é calculada na hora. */
  async definir(a: Acesso, d: { tipo: 'cliente' | 'fornecedor'; id: string; empresaVinculadaId: string | null }) {
    this.soAdministrativo(a);
    return this.db.tenant(contextoDb(a), async (c) => {
      const tabela = d.tipo === 'cliente' ? 'cliente' : 'fornecedor';
      const atual = (await c.query(`SELECT nome, empresa_vinculada_id AS v FROM ${tabela} WHERE id = $1 FOR UPDATE`, [d.id])).rows[0];
      if (!atual) throw new NotFoundException(`${d.tipo === 'cliente' ? 'Cliente' : 'Fornecedor'} não encontrado.`);
      if (d.empresaVinculadaId && !(await c.query('SELECT 1 FROM empresa WHERE id = $1', [d.empresaVinculadaId])).rows[0]) throw new ConflictException('Empresa não encontrada neste grupo.');
      await c.query(`UPDATE ${tabela} SET empresa_vinculada_id = $2 WHERE id = $1`, [d.id, d.empresaVinculadaId]);
      await auditar(c, a, { acao: 'consolidado.vinculo', entidade: tabela, entidadeId: d.id, antes: { empresaVinculadaId: atual.v }, depois: { nome: atual.nome, empresaVinculadaId: d.empresaVinculadaId } });
      return { ok: true };
    });
  }
}
