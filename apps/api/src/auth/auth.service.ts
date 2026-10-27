import { BadRequestException, ConflictException, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Perfil } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { ENV, Env } from '../config/env';
import { Acesso, contextoDb } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { conferirSenha, hashSenha, novoToken, sha256 } from './senha';
import { Tentativas } from '../common/tentativas';

export interface RespostaLogin {
  token: string;
  expiraEm: Date;
  acesso: Acesso;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService, @Inject(ENV) private readonly env: Env, private readonly tentativas: Tentativas) {}

  async login(email: string, senha: string, ip?: string, userAgent?: string): Promise<RespostaLogin> {
    const chave = this.tentativas.chave('app', email);
    await this.tentativas.exigirSemBloqueio(chave);

    const u = await this.db.semTenant(async (c) => (await c.query('SELECT * FROM auth_buscar_usuario($1)', [email])).rows[0]);
    const ok = await conferirSenha(u?.senha_hash ?? null, senha);
    await this.tentativas.registrar(chave, ip, ok && u?.status === 'ATIVO');
    if (!ok || !u || u.status !== 'ATIVO') throw new UnauthorizedException('E-mail ou senha incorretos.');
    if (u.grupo_status !== 'ATIVO') throw new ForbiddenException('O acesso do seu grupo está suspenso. Fale com o suporte.');

    const token = novoToken();
    const expiraEm = new Date(Date.now() + this.env.SESSAO_HORAS * 3_600_000);
    const acesso = await this.db.tenant({ grupoId: u.grupo_id, usuarioId: u.id, rede: false, empresas: [] }, async (c) => {
      const base = await this.carregarEmpresas(c, u.id, u.acesso_rede);
      const ativa = base[0]?.id ?? null;
      const s = await c.query(
        `INSERT INTO sessao (token_hash, usuario_id, grupo_id, empresa_ativa_id, expira_em, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [sha256(token), u.id, u.grupo_id, ativa, expiraEm, ip ?? null, userAgent ?? null],
      );
      await c.query('UPDATE usuario SET ultimo_login_em = now() WHERE id = $1', [u.id]);
      const a: Acesso = {
        sessaoId: s.rows[0].id, usuarioId: u.id, nome: u.nome, email: u.email, grupoId: u.grupo_id,
        rede: u.acesso_rede, empresas: base, empresaAtivaId: ativa, ip, userAgent,
      };
      await auditar(c, a, { acao: 'auth.login', entidade: 'sessao', entidadeId: a.sessaoId, empresaId: ativa });
      return a;
    });
    return { token, expiraEm, acesso };
  }

  /** Lojas do usuário. O Administrativo (rede) vê todas as ativas, com perfil Administrativo. */
  private async carregarEmpresas(c: import('pg').PoolClient, usuarioId: string, rede: boolean): Promise<{ id: string; perfil: Perfil }[]> {
    if (rede) {
      await c.query(`SELECT set_config('app.rede', 'on', true)`);
      const r = await c.query(`SELECT id FROM empresa WHERE status = 'ATIVO' ORDER BY nome_fantasia`);
      await c.query(`SELECT set_config('app.rede', 'off', true)`);
      return r.rows.map((x) => ({ id: x.id, perfil: 'ADMINISTRATIVO' as Perfil }));
    }
    // 1) as lotações do próprio usuário (o banco sempre as mostra a ele); 2) só então a loja fica visível.
    const lot = (await c.query('SELECT empresa_id AS id, perfil FROM usuario_empresa_perfil WHERE usuario_id = $1', [usuarioId])).rows;
    if (lot.length === 0) return [];
    await c.query(`SELECT set_config('app.empresas', $1, true)`, [lot.map((x) => x.id).join(',')]);
    const ativas = (await c.query(`SELECT id FROM empresa WHERE status = 'ATIVO' ORDER BY nome_fantasia`)).rows.map((x) => x.id as string);
    await c.query(`SELECT set_config('app.empresas', '', true)`);
    return ativas.map((id) => ({ id, perfil: lot.find((x) => x.id === id)!.perfil as Perfil }));
  }

  /** Resolve a sessão a partir do cookie. Retorna null se inválida, expirada ou se usuário/grupo foram suspensos. */
  async acessoPorToken(token: string, ip?: string, userAgent?: string): Promise<Acesso | null> {
    const s = await this.db.semTenant(async (c) => (await c.query('SELECT * FROM auth_buscar_sessao($1)', [sha256(token)])).rows[0]);
    if (!s) return null;
    return this.db.tenant({ grupoId: s.grupo_id, usuarioId: s.usuario_id, rede: false, empresas: [] }, async (c) => {
      const u = (await c.query('SELECT nome, email FROM usuario WHERE id = $1', [s.usuario_id])).rows[0];
      const empresas = await this.carregarEmpresas(c, s.usuario_id, s.acesso_rede);
      const ativa = empresas.some((e) => e.id === s.empresa_ativa_id) ? s.empresa_ativa_id : (empresas[0]?.id ?? null);
      const acesso: Acesso = {
        sessaoId: s.sessao_id, usuarioId: s.usuario_id, nome: u.nome, email: u.email, grupoId: s.grupo_id,
        rede: s.acesso_rede, empresas, empresaAtivaId: ativa, ip, userAgent,
      };
      if (s.sessao_suporte_id) {
        const ss = (await this.db.semTenant((cc) => cc.query(
          `SELECT ss.id, ss.usuario_interno_id, ss.motivo, ss.expira_em, ss.encerrada_em, ui.nome
             FROM sessao_suporte ss JOIN usuario_interno ui ON ui.id = ss.usuario_interno_id WHERE ss.id = $1`, [s.sessao_suporte_id]))).rows[0];
        if (!ss || ss.encerrada_em || new Date(ss.expira_em) <= new Date()) return null;
        acesso.suporte = { id: ss.id, usuarioInternoId: ss.usuario_interno_id, usuarioInterno: ss.nome, motivo: ss.motivo, expiraEm: new Date(ss.expira_em).toISOString() };
      }
      return acesso;
    });
  }

  async logout(a: Acesso) {
    await this.db.tenant(contextoDb(a), async (c) => {
      await c.query('UPDATE sessao SET revogada_em = now() WHERE id = $1', [a.sessaoId]);
      if (a.suporte) await this.db.semTenant((cc) => cc.query('UPDATE sessao_suporte SET encerrada_em = now() WHERE id = $1', [a.suporte!.id]));
      await auditar(c, a, { acao: a.suporte ? 'suporte.acesso_encerrado' : 'auth.logout', entidade: 'sessao', entidadeId: a.sessaoId, empresaId: a.empresaAtivaId });
    });
  }

  async trocarEmpresa(a: Acesso, empresaId: string): Promise<Acesso> {
    if (!a.empresas.some((e) => e.id === empresaId)) throw new ForbiddenException('Você não tem acesso a esta empresa.');
    await this.db.tenant(contextoDb(a), (c) => c.query('UPDATE sessao SET empresa_ativa_id = $2 WHERE id = $1', [a.sessaoId, empresaId]));
    return { ...a, empresaAtivaId: empresaId };
  }

  /** Troca o ticket de uso único do backoffice por uma sessão curta de suporte. */
  async trocarTicketSuporte(ticket: string, ip?: string, userAgent?: string): Promise<RespostaLogin> {
    const ss = (await this.db.semTenant((c) => c.query(
      `UPDATE sessao_suporte SET ticket_usado_em = now()
        WHERE ticket_hash = $1 AND ticket_usado_em IS NULL AND encerrada_em IS NULL AND expira_em > now()
        RETURNING id, grupo_id, usuario_interno_id, motivo, expira_em`, [sha256(ticket)]))).rows[0];
    if (!ss) throw new BadRequestException('Este acesso de suporte expirou ou já foi usado.');
    const token = novoToken();
    const acesso = await this.db.tenant({ grupoId: ss.grupo_id, rede: true, empresas: [] }, async (c) => {
      const adm = (await c.query(`SELECT id, nome, email FROM usuario WHERE acesso_rede AND status = 'ATIVO' ORDER BY criado_em LIMIT 1`)).rows[0];
      if (!adm) throw new ConflictException('Este grupo não tem um Administrativo ativo.');
      const empresas = await this.carregarEmpresas(c, adm.id, true);
      const ativa = empresas[0]?.id ?? null;
      await c.query(`SELECT set_config('app.usuario_id', $1, true), set_config('app.rede', 'off', true)`, [adm.id]);
      const sess = await c.query(
        `INSERT INTO sessao (token_hash, usuario_id, grupo_id, empresa_ativa_id, expira_em, ip, user_agent, sessao_suporte_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [sha256(token), adm.id, ss.grupo_id, ativa, ss.expira_em, ip ?? null, userAgent ?? null, ss.id],
      );
      const nomeInterno = (await this.db.semTenant((cc) => cc.query('SELECT nome FROM usuario_interno WHERE id = $1', [ss.usuario_interno_id]))).rows[0].nome;
      const a: Acesso = {
        sessaoId: sess.rows[0].id, usuarioId: adm.id, nome: adm.nome, email: adm.email, grupoId: ss.grupo_id, rede: true,
        empresas, empresaAtivaId: ativa, ip, userAgent,
        suporte: { id: ss.id, usuarioInternoId: ss.usuario_interno_id, usuarioInterno: nomeInterno, motivo: ss.motivo, expiraEm: new Date(ss.expira_em).toISOString() },
      };
      await auditar(c, a, { acao: 'suporte.sessao_aberta', entidade: 'sessao', entidadeId: a.sessaoId, motivo: ss.motivo });
      return a;
    });
    return { token, expiraEm: new Date(ss.expira_em), acesso };
  }

  async aceitarConvite(token: string, senha: string) {
    const conv = await this.db.semTenant(async (c) => (await c.query('SELECT * FROM auth_buscar_convite($1)', [sha256(token)])).rows[0]);
    if (!conv) throw new BadRequestException('Este convite expirou ou já foi usado. Peça um novo.');
    const novoHash = await hashSenha(senha);
    await this.db.tenant({ grupoId: conv.grupo_id, usuarioId: conv.id, rede: false, empresas: [] }, async (c) => {
      await c.query('UPDATE usuario SET senha_hash = $2, convite_hash = NULL, convite_expira_em = NULL WHERE id = $1', [conv.id, novoHash]);
      await auditar(c, { grupoId: conv.grupo_id, usuarioId: conv.id }, { acao: 'usuario.convite_aceito', entidade: 'usuario', entidadeId: conv.id });
    });
  }

  static novoId = () => randomUUID();
}
