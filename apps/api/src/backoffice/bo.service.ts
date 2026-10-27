import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MINUTOS_SUPORTE, type criarGrupoSchema } from '@ecv/shared';
import type { z } from 'zod';
import { DbService } from '../db/db.service';
import { ENV, Env } from '../config/env';
import { Mailer } from '../mail/mailer';
import { auditar } from '../common/auditoria';
import { novoToken, sha256 } from '../auth/senha';
import type { AcessoInterno } from './bo-acesso';

type CriarGrupo = z.infer<typeof criarGrupoSchema>;
const na = (g: string) => ({ grupoId: g, rede: true, empresas: [] as string[] });

@Injectable()
export class BoService {
  constructor(private readonly db: DbService, private readonly mailer: Mailer, @Inject(ENV) private readonly env: Env) {}

  listarGrupos() {
    return this.db.semTenant(async (c) => (await c.query(
      `SELECT id, nome, status, criado_em AS "criadoEm", empresas::int, usuarios::int, ultimo_acesso AS "ultimoAcesso" FROM bo_listar_grupos()`)).rows);
  }

  async detalhe(grupoId: string) {
    return this.db.tenant(na(grupoId), async (c) => {
      const g = (await c.query('SELECT id, nome, status, criado_em AS "criadoEm" FROM grupo')).rows[0];
      if (!g) throw new NotFoundException('Grupo não encontrado.');
      const empresas = (await c.query(`SELECT id, cnpj, nome_fantasia AS "nomeFantasia", uf, cidade, status FROM empresa ORDER BY nome_fantasia`)).rows;
      const usuarios = (await c.query(
        `SELECT u.id, u.nome, u.email, u.status, u.acesso_rede AS "acessoRede", (u.senha_hash IS NULL) AS "convitePendente", u.ultimo_login_em AS "ultimoLogin",
                coalesce(json_agg(json_build_object('empresaId', p.empresa_id, 'perfil', p.perfil)) FILTER (WHERE p.usuario_id IS NOT NULL), '[]') AS lotacoes
           FROM usuario u LEFT JOIN usuario_empresa_perfil p ON p.usuario_id = u.id GROUP BY u.id ORDER BY u.nome`)).rows;
      const acessos = (await this.db.semTenant((cc) => cc.query(
        `SELECT ss.id, ss.motivo, ss.inicio, ss.expira_em AS "expiraEm", ss.encerrada_em AS "encerradaEm", ui.nome AS "usuarioInterno"
           FROM sessao_suporte ss JOIN usuario_interno ui ON ui.id = ss.usuario_interno_id WHERE ss.grupo_id = $1 ORDER BY ss.inicio DESC LIMIT 20`, [grupoId]))).rows;
      return { ...g, empresas, usuarios, acessosSuporte: acessos };
    });
  }

  /** Abre um cliente novo: o grupo nasce com o próprio id no contexto, sem nenhum acesso especial ao banco. */
  async criarGrupo(i: AcessoInterno, dto: CriarGrupo) {
    const grupoId = randomUUID();
    const empresaId = randomUUID();
    const usuarioId = randomUUID();
    const token = novoToken();
    const link = `${this.env.URL_APP}/convite?token=${token}`;
    await this.db.tenant(na(grupoId), async (c) => {
      await c.query('INSERT INTO grupo (id, nome) VALUES ($1,$2)', [grupoId, dto.nome]);
      try {
        await c.query(
          `INSERT INTO empresa (id, grupo_id, cnpj, razao_social, nome_fantasia, uf, cidade, regime, email_financeiro)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [empresaId, grupoId, dto.empresa.cnpj, dto.empresa.razaoSocial, dto.empresa.nomeFantasia, dto.empresa.uf, dto.empresa.cidade, dto.empresa.regimeTributario, dto.empresa.emailFinanceiro ?? null],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe uma empresa com este CNPJ.');
        throw e;
      }
      try {
        await c.query(
          `INSERT INTO usuario (id, grupo_id, nome, email, acesso_rede, convite_hash, convite_expira_em)
           VALUES ($1,$2,$3,$4,true,$5, now() + interval '7 days')`,
          [usuarioId, grupoId, dto.administrativo.nome, dto.administrativo.email, sha256(token)],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe um usuário com este e-mail.');
        throw e;
      }
      await auditar(c, { grupoId, usuarioInternoId: i.id, ip: i.ip, userAgent: i.userAgent }, {
        acao: 'grupo.criado', entidade: 'grupo', entidadeId: grupoId, depois: { nome: dto.nome, empresa: dto.empresa.nomeFantasia, administrativo: dto.administrativo.email },
      });
    });
    await this.mailer.enviarConvite(dto.administrativo.email, dto.administrativo.nome, link);
    return { grupoId, empresaId, ...(this.env.EXPOR_CONVITE === 'true' ? { conviteLink: link } : {}) };
  }

  async alterarStatus(i: AcessoInterno, grupoId: string, status: 'ATIVO' | 'SUSPENSO', motivo: string) {
    return this.db.tenant(na(grupoId), async (c) => {
      const antes = (await c.query('SELECT status FROM grupo')).rows[0];
      if (!antes) throw new NotFoundException('Grupo não encontrado.');
      await c.query('UPDATE grupo SET status = $1 WHERE id = $2', [status, grupoId]);
      await auditar(c, { grupoId, usuarioInternoId: i.id, ip: i.ip, userAgent: i.userAgent }, {
        acao: status === 'SUSPENSO' ? 'grupo.suspenso' : 'grupo.reativado', entidade: 'grupo', entidadeId: grupoId, antes, depois: { status }, motivo,
      });
      return { id: grupoId, status };
    });
  }

  async auditoria(grupoId: string, limite = 100) {
    return this.db.tenant(na(grupoId), async (c) => (await c.query(
      `SELECT l.id, l.criado_em AS "criadoEm", l.acao, l.entidade, l.entidade_id AS "entidadeId", l.motivo,
              coalesce(u.nome, 'Equipe ECV Cash: ' || ui.nome) AS autor
         FROM auditoria_log l LEFT JOIN usuario u ON u.id = l.usuario_id LEFT JOIN usuario_interno ui ON ui.id = l.usuario_interno_id
        ORDER BY l.id DESC LIMIT $1`, [limite])).rows);
  }

  /** O usuário perde a senha e a sessão atual e recebe um convite novo: ele define a senha de novo. */
  async redefinirAcesso(i: AcessoInterno, grupoId: string, usuarioId: string) {
    const token = novoToken();
    const link = `${this.env.URL_APP}/convite?token=${token}`;
    const alvo = await this.db.tenant(na(grupoId), async (c) => {
      const u = (await c.query('SELECT id, nome, email FROM usuario WHERE id = $1', [usuarioId])).rows[0];
      if (!u) throw new NotFoundException('Usuário não encontrado neste grupo.');
      await c.query(`UPDATE usuario SET senha_hash = NULL, convite_hash = $2, convite_expira_em = now() + interval '7 days' WHERE id = $1`, [usuarioId, sha256(token)]);
      await auditar(c, { grupoId, usuarioInternoId: i.id, ip: i.ip, userAgent: i.userAgent }, { acao: 'usuario.acesso_redefinido', entidade: 'usuario', entidadeId: usuarioId, depois: { email: u.email } });
      return u;
    });
    await this.db.tenant({ grupoId, usuarioId, rede: false, empresas: [] }, (c) => c.query('UPDATE sessao SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [usuarioId]));
    await this.mailer.enviarConvite(alvo.email, alvo.nome, link);
    return { ok: true, ...(this.env.EXPOR_CONVITE === 'true' ? { conviteLink: link } : {}) };
  }

  async entrarComo(i: AcessoInterno, grupoId: string, motivo: string) {
    const ticket = novoToken();
    const expiraEm = new Date(Date.now() + MINUTOS_SUPORTE * 60_000);
    await this.db.tenant(na(grupoId), async (c) => {
      const g = (await c.query('SELECT status FROM grupo')).rows[0];
      if (!g) throw new NotFoundException('Grupo não encontrado.');
      if (g.status !== 'ATIVO') throw new ConflictException('O grupo está suspenso. Reative antes de entrar como o cliente.');
      const adm = (await c.query(`SELECT 1 FROM usuario WHERE acesso_rede AND status = 'ATIVO' LIMIT 1`)).rows[0];
      if (!adm) throw new ConflictException('Este grupo não tem um Administrativo ativo.');
      const id = (await this.db.semTenant((cc) => cc.query(
        `INSERT INTO sessao_suporte (usuario_interno_id, grupo_id, motivo, expira_em, ticket_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [i.id, grupoId, motivo, expiraEm, sha256(ticket)]))).rows[0].id;
      await auditar(c, { grupoId, usuarioInternoId: i.id, ip: i.ip, userAgent: i.userAgent }, {
        acao: 'suporte.acesso_iniciado', entidade: 'sessao_suporte', entidadeId: id, motivo, depois: { expiraEm },
      });
    });
    return { url: `${this.env.URL_APP}/suporte#ticket=${ticket}`, ticket, expiraEm };
  }
}
