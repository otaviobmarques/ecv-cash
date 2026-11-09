import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CHAVE_DEV, ENV, Env } from '../config/env';
import { Cripto } from '../common/cripto';
import { Tentativas } from '../common/tentativas';
import { conferirSenha, novoToken, sha256 } from '../auth/senha';
import { novoSegredoTotp, passoAtual, uriTotp, verificarTotp } from './totp';
import type { AcessoInterno } from './bo-acesso';
import type { PapelInterno } from '@ecv/shared';

const HORAS_SESSAO = 8;
const VALIDADE_TICKET_SEG = 300;

type TicketMfa = { uid: string; etapa: 'MFA' | 'CONFIGURAR'; segredo?: string };

@Injectable()
export class BoAuthService {
  readonly cripto: Cripto;
  private readonly exigir2fa: boolean;

  constructor(private readonly db: DbService, @Inject(ENV) env: Env, private readonly tentativas: Tentativas) {
    this.cripto = new Cripto(env.CHAVE_SEGREDOS ?? CHAVE_DEV);
    this.exigir2fa = env.BO_EXIGIR_2FA === 'true';
  }

  /** Passo 1: e-mail e senha. Devolve um ticket de 5 minutos para o passo do código de 6 dígitos. */
  async login(email: string, senha: string, ip?: string, userAgent?: string) {
    const chave = this.tentativas.chave('bo', email);
    await this.tentativas.exigirSemBloqueio(chave);
    const u = (await this.db.semTenant((c) => c.query('SELECT id, nome, email, papel, senha_hash, status, mfa_secret FROM usuario_interno WHERE lower(email) = lower($1)', [email]))).rows[0];
    const ok = await conferirSenha(u?.senha_hash ?? null, senha);
    if (!ok || u.status !== 'ATIVO') {
      await this.tentativas.registrar(chave, ip, false);
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    if (!this.exigir2fa) {
      // 2FA desligado (BO_EXIGIR_2FA=false): a senha basta e a sessão já nasce aqui.
      await this.tentativas.registrar(chave, ip, true);
      return { etapa: 'ENTROU' as const, ...(await this.abrirSessao(u, ip, userAgent)) };
    }
    if (u.mfa_secret) {
      return { etapa: 'MFA' as const, ticket: this.cripto.assinar({ uid: u.id, etapa: 'MFA' }, VALIDADE_TICKET_SEG) };
    }
    const segredo = novoSegredoTotp();
    return {
      etapa: 'CONFIGURAR_MFA' as const,
      ticket: this.cripto.assinar({ uid: u.id, etapa: 'CONFIGURAR', segredo: this.cripto.cifrar(segredo) }, VALIDADE_TICKET_SEG),
      segredo,
      uri: uriTotp(segredo, u.email),
    };
  }

  /** Passo 2: código do aplicativo autenticador. Na primeira vez também grava o segredo. */
  async mfa(ticket: string, codigo: string, ip?: string, userAgent?: string) {
    const p = this.cripto.verificar<TicketMfa & Record<string, unknown>>(ticket);
    if (!p) throw new UnauthorizedException('A verificação expirou. Entre de novo com e-mail e senha.');
    const u = (await this.db.semTenant((c) => c.query('SELECT id, nome, email, papel, status, mfa_secret, mfa_ultimo_passo FROM usuario_interno WHERE id = $1', [p.uid]))).rows[0];
    if (!u || u.status !== 'ATIVO') throw new UnauthorizedException('A verificação expirou. Entre de novo com e-mail e senha.');
    const chave = this.tentativas.chave('bo', u.email);
    await this.tentativas.exigirSemBloqueio(chave);

    const configurando = p.etapa === 'CONFIGURAR';
    if (configurando && u.mfa_secret) throw new BadRequestException('A verificação em duas etapas já está configurada.');
    const segredo = configurando ? this.cripto.decifrar(p.segredo!) : this.cripto.decifrar(u.mfa_secret);
    const passo = verificarTotp(segredo, codigo);
    // o mesmo código não vale duas vezes (um passo já usado, ou anterior, é recusado)
    if (passo === null || (u.mfa_ultimo_passo !== null && passo <= Number(u.mfa_ultimo_passo))) {
      await this.tentativas.registrar(chave, ip, false);
      throw new UnauthorizedException('Código incorreto ou já usado. Confira o aplicativo autenticador.');
    }
    await this.tentativas.registrar(chave, ip, true);
    await this.db.semTenant((c) => c.query('UPDATE usuario_interno SET mfa_ultimo_passo = $2, mfa_secret = coalesce(mfa_secret, $3) WHERE id = $1', [u.id, passo, configurando ? this.cripto.cifrar(segredo) : null]));
    return this.abrirSessao(u, ip, userAgent);
  }

  private async abrirSessao(u: { id: string; nome: string; email: string; papel: string }, ip?: string, userAgent?: string) {
    const token = novoToken();
    const expiraEm = new Date(Date.now() + HORAS_SESSAO * 3_600_000);
    await this.db.semTenant((c) => c.query('INSERT INTO sessao_interna (token_hash, usuario_interno_id, expira_em, ip, user_agent) VALUES ($1,$2,$3,$4,$5)', [sha256(token), u.id, expiraEm, ip ?? null, userAgent ?? null]));
    return { token, expiraEm, interno: { id: u.id, nome: u.nome, email: u.email, papel: u.papel as PapelInterno } };
  }

  async acessoPorToken(token: string, ip?: string, userAgent?: string): Promise<AcessoInterno | null> {
    const r = (await this.db.semTenant((c) => c.query(
      `SELECT s.id AS sessao_id, u.id, u.nome, u.email, u.papel FROM sessao_interna s
         JOIN usuario_interno u ON u.id = s.usuario_interno_id AND u.status = 'ATIVO'
        WHERE s.token_hash = $1 AND s.revogada_em IS NULL AND s.expira_em > now()`, [sha256(token)]))).rows[0];
    return r ? { sessaoId: r.sessao_id, id: r.id, nome: r.nome, email: r.email, papel: r.papel, ip, userAgent } : null;
  }

  logout(a: AcessoInterno) {
    return this.db.semTenant((c) => c.query('UPDATE sessao_interna SET revogada_em = now() WHERE id = $1', [a.sessaoId]));
  }
}
