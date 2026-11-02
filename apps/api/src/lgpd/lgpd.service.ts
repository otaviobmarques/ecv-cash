import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb } from '../common/acesso';
import { auditar } from '../common/auditoria';

@Injectable()
export class LgpdService {
  constructor(private readonly db: DbService) {}

  private soAdministrativo(a: Acesso) {
    if (!a.rede) throw new ForbiddenException('Só o Administrativo atende solicitações de titulares de dados.');
  }

  /** O que o sistema guarda sobre uma pessoa física (resposta ao pedido de acesso do titular). Registrado na auditoria. */
  async dadosDoTitular(a: Acesso, clienteId: string) {
    this.soAdministrativo(a);
    return this.db.tenant(contextoDb(a), async (c) => {
      const cl = (await c.query(`SELECT id, tipo_pessoa AS "tipoPessoa", nome, documento, emails_cobranca AS emails, telefone, criado_em AS "criadoEm", anonimizado_em AS "anonimizadoEm" FROM cliente WHERE id = $1`, [clienteId])).rows[0];
      if (!cl) throw new NotFoundException('Cliente não encontrado.');
      const laudos = (await c.query(`SELECT l.numero_interno::int AS numero, l.data_laudo::text AS data, l.placa, s.nome AS servico, l.valor_cobrado_centavos AS "valorCentavos", l.status FROM laudo l JOIN servico s ON s.id = l.servico_id WHERE l.cliente_id = $1 ORDER BY l.data_laudo DESC LIMIT 1000`, [clienteId])).rows;
      const faturas = (await c.query(`SELECT numero::int AS numero, emissao::text, vencimento::text, total_centavos AS "totalCentavos", status FROM fatura WHERE cliente_id = $1 ORDER BY emissao DESC`, [clienteId])).rows;
      await auditar(c, a, { acao: 'lgpd.acesso_titular', entidade: 'cliente', entidadeId: clienteId, depois: { laudos: laudos.length, faturas: faturas.length } });
      return { cliente: cl, laudos, faturas, retencao: 'Dados de laudos, faturas e recebimentos são mantidos por 5 anos por obrigação legal; depois disso ficam disponíveis para anonimização.' };
    });
  }

  /** Remove o que identifica a pessoa e mantém os valores e datas dos lançamentos, que a lei manda guardar. Não tem volta. */
  async anonimizar(a: Acesso, clienteId: string, motivo: string) {
    this.soAdministrativo(a);
    return this.db.tenant(contextoDb(a), async (c) => {
      const cl = (await c.query('SELECT tipo_pessoa AS tipo, nome, anonimizado_em AS em FROM cliente WHERE id = $1 FOR UPDATE', [clienteId])).rows[0];
      if (!cl) throw new NotFoundException('Cliente não encontrado.');
      if (cl.tipo !== 'PF') throw new ConflictException('A anonimização vale para pessoa física. Dados de empresa não são dados pessoais.');
      if (cl.em) throw new ConflictException('Este cliente já foi anonimizado.');
      await c.query(
        `UPDATE cliente SET nome = 'Cliente anonimizado ' || left(id::text, 8), documento = NULL, emails_cobranca = '{}', telefone = NULL, status = 'INATIVO', anonimizado_em = now() WHERE id = $1`, [clienteId]);
      await auditar(c, a, { acao: 'lgpd.anonimizado', entidade: 'cliente', entidadeId: clienteId, antes: { nome: cl.nome }, depois: { anonimizado: true }, motivo });
      return { ok: true };
    });
  }
}
