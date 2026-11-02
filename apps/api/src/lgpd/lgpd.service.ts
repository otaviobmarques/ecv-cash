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

  /**
   * Pessoas físicas sem movimento há pelo menos `anos` anos (último laudo, ou o cadastro, se nunca houve laudo) e sem nada em aberto.
   * A guarda legal dos lançamentos é de 5 anos: o mínimo aqui também é 5.
   */
  async retencao(a: Acesso, anos: number) {
    this.soAdministrativo(a);
    return this.db.tenant(contextoDb(a), async (c) => {
      const itens = (await c.query(
        `SELECT cl.id, cl.nome, cl.documento, coalesce(u.ultimo, cl.criado_em::date)::text AS "ultimoMovimento", (u.ultimo IS NULL) AS "nuncaTeveLaudo"
           FROM cliente cl LEFT JOIN LATERAL (SELECT max(l.data_laudo) AS ultimo FROM laudo l WHERE l.cliente_id = cl.id) u ON true
          WHERE cl.tipo_pessoa = 'PF' AND cl.anonimizado_em IS NULL AND coalesce(u.ultimo, cl.criado_em::date) < (current_date - make_interval(years => $1))
            AND NOT EXISTS (SELECT 1 FROM titulo_receber t WHERE t.cliente_id = cl.id AND t.status IN ('ABERTO','PARCIAL'))
            AND NOT EXISTS (SELECT 1 FROM fatura f WHERE f.cliente_id = cl.id AND f.status IN ('ABERTA','PARCIAL'))
          ORDER BY 4, cl.nome LIMIT 500`, [anos])).rows;
      return { anos, itens: itens.map((i) => ({ ...i, documento: i.documento ? `•••.${i.documento.slice(3, 6)}.•••-${i.documento.slice(-2)}` : null })) };
    });
  }

  /** Anonimiza vários de uma vez, cada um na sua transação; só entra quem ainda cumpre o prazo (a conferência é feita de novo na hora). */
  async anonimizarLote(a: Acesso, ids: string[], anos: number) {
    this.soAdministrativo(a);
    const elegiveis = new Set((await this.retencao(a, anos)).itens.map((i: { id: string }) => i.id));
    const resultados: { id: string; ok: boolean; erro?: string }[] = [];
    for (const id of ids) {
      if (!elegiveis.has(id)) { resultados.push({ id, ok: false, erro: `Não cumpre o prazo de ${anos} anos sem movimento, ou tem valor em aberto.` }); continue; }
      try { await this.anonimizar(a, id, `Prazo de retenção de ${anos} anos vencido`); resultados.push({ id, ok: true }); }
      catch (e) { resultados.push({ id, ok: false, erro: (e as Error).message }); }
    }
    return { anonimizados: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).length, resultados };
  }
}
