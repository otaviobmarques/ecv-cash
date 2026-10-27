import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Perfil } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { ENV, Env } from '../config/env';
import { Acesso, contextoDb } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { conferirSenha, hashSenha, novoToken, sha256 } from './senha';

const MAX_FALHAS = 5;
const JANELA_MIN = 15;

export interface RespostaLogin {
  token: string;
  expiraEm: Date;
  acesso: Acesso;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService, @Inject(ENV) private readonly env: Env) {}

  async login(email: string, senha: string, ip?: string, userAgent?: string): Promise<RespostaLogin> {
    const chave = sha256(email.toLowerCase()).toString('hex');
    await this.exigirSemBloqueio(chave);

    const u = await this.db.semTenant(async (c) => (await c.query('SELECT * FROM auth_buscar_usuario($1)', [email])).rows[0]);
    const ok = await conferirSenha(u?.senha_hash ?? null, senha);
    await this.db.semTenant((c) => c.query('INSERT INTO login_tentativa (chave, ip, sucesso) VALUES ($1,$2,$3)', [chave, ip ?? null, ok && u?.status === 'ATIVO']));
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

  private async exigirSemBloqueio(chave: string) {
    const falhas = await this.db.semTenant(async (c) =>
      Number((await c.query(
        `SELECT count(*) AS n FROM login_tentativa
          WHERE chave = $1 AND NOT sucesso AND criado_em > now() - make_interval(mins => $2)
            AND criado_em > coalesce((SELECT max(criado_em) FROM login_tentativa WHERE chave = $1 AND sucesso), '-infinity')`,
        [chave, JANELA_MIN],
      )).rows[0].n),
    );
    if (falhas >= MAX_FALHAS) {
      throw new HttpException('Muitas tentativas. Tente de novo em alguns minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
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
      return {
        sessaoId: s.sessao_id, usuarioId: s.usuario_id, nome: u.nome, email: u.email, grupoId: s.grupo_id,
        rede: s.acesso_rede, empresas, empresaAtivaId: ativa, ip, userAgent,
      };
    });
  }

  async logout(a: Acesso) {
    await this.db.tenant(contextoDb(a), async (c) => {
      await c.query('UPDATE sessao SET revogada_em = now() WHERE id = $1', [a.sessaoId]);
      await auditar(c, a, { acao: 'auth.logout', entidade: 'sessao', entidadeId: a.sessaoId, empresaId: a.empresaAtivaId });
    });
  }

  async trocarEmpresa(a: Acesso, empresaId: string): Promise<Acesso> {
    if (!a.empresas.some((e) => e.id === empresaId)) throw new ForbiddenException('Você não tem acesso a esta empresa.');
    await this.db.tenant(contextoDb(a), (c) => c.query('UPDATE sessao SET empresa_ativa_id = $2 WHERE id = $1', [a.sessaoId, empresaId]));
    return { ...a, empresaAtivaId: empresaId };
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
