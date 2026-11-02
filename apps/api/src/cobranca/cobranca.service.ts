import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { formatarBRL } from '@ecv/shared';
import { DbService, type ContextoDb } from '../db/db.service';
import { ENV, type Env } from '../config/env';
import { Mailer } from '../mail/mailer';
import { Acesso, contextoDb, exigir } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { hojeSP } from '../caixa/razao';
import { FaturasService } from '../faturas/faturas.service';

type TipoEmail = 'FATURA' | 'LEMBRETE' | 'ATRASO' | 'MANUAL';
export interface Regua { ativa: boolean; enviarAoGerar: boolean; diasAntes: number[]; diasApos: number[]; copiaPara: string | null }
const REGUA_PADRAO: Regua = { ativa: false, enviarAoGerar: true, diasAntes: [3], diasApos: [1, 7, 15], copiaPara: null };
const br = (iso: string) => iso.split('-').reverse().join('/');
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const dias = (d: string, h: string) => Math.round((Date.parse(d) - Date.parse(h)) / 86_400_000);

@Injectable()
export class CobrancaService {
  private readonly log = new Logger('Cobranca');
  constructor(private readonly db: DbService, private readonly faturas: FaturasService, private readonly mailer: Mailer, @Inject(ENV) private readonly env: Env) {}

  private empresaAtiva(a: Acesso): string {
    if (!a.empresaAtivaId) throw new ForbiddenException('Escolha a empresa em que está trabalhando.');
    return a.empresaAtivaId;
  }

  private async lerRegua(c: PoolClient, empresaId: string): Promise<Regua> {
    const r = (await c.query('SELECT ativa, enviar_ao_gerar AS "enviarAoGerar", dias_antes AS "diasAntes", dias_apos AS "diasApos", copia_para AS "copiaPara" FROM regua_cobranca WHERE empresa_id = $1', [empresaId])).rows[0];
    return r ?? REGUA_PADRAO;
  }

  async regua(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => ({ ...(await this.lerRegua(c, empresaId)), smtpConfigurado: this.mailer.configurado }));
  }

  async salvarRegua(a: Acesso, d: Partial<Regua>) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'regua_cobranca.editar', empresaId);
    const lista = (v: number[] | undefined, campo: string) => {
      if (v === undefined) return undefined;
      const u = [...new Set(v)].sort((x, y) => x - y);
      if (u.length > 5 || u.some((n) => !Number.isInteger(n) || n < 0 || n > 90)) throw new UnprocessableEntityException({ mensagem: 'Use até 5 prazos, entre 0 e 90 dias.', campos: { [campo]: 'Use até 5 prazos, entre 0 e 90 dias.' } });
      return u;
    };
    const antes = lista(d.diasAntes, 'diasAntes'); const apos = lista(d.diasApos, 'diasApos');
    if (d.copiaPara && !emailOk(d.copiaPara)) throw new UnprocessableEntityException({ mensagem: 'E-mail de cópia inválido.', campos: { copiaPara: 'Confira o e-mail.' } });
    return this.db.tenant(contextoDb(a), async (c) => {
      const atual = await this.lerRegua(c, empresaId);
      const novo: Regua = { ativa: d.ativa ?? atual.ativa, enviarAoGerar: d.enviarAoGerar ?? atual.enviarAoGerar, diasAntes: antes ?? atual.diasAntes, diasApos: apos ?? atual.diasApos, copiaPara: d.copiaPara === undefined ? atual.copiaPara : d.copiaPara || null };
      await c.query(
        `INSERT INTO regua_cobranca (empresa_id, grupo_id, ativa, enviar_ao_gerar, dias_antes, dias_apos, copia_para) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (empresa_id) DO UPDATE SET ativa = EXCLUDED.ativa, enviar_ao_gerar = EXCLUDED.enviar_ao_gerar, dias_antes = EXCLUDED.dias_antes, dias_apos = EXCLUDED.dias_apos, copia_para = EXCLUDED.copia_para, atualizado_em = now()`,
        [empresaId, a.grupoId, novo.ativa, novo.enviarAoGerar, novo.diasAntes, novo.diasApos, novo.copiaPara]);
      await auditar(c, a, { acao: 'cobranca.regua_alterada', entidade: 'regua_cobranca', entidadeId: empresaId, empresaId, antes: atual, depois: novo });
      return { ...novo, smtpConfigurado: this.mailer.configurado };
    });
  }

  async envios(a: Acesso, faturaId?: string) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'receber.ver', empresaId);
    return this.db.tenant(contextoDb(a), async (c) => (await c.query(
      `SELECT e.id, e.fatura_id AS "faturaId", f.numero::int AS fatura, cl.nome AS cliente, e.tipo, e.dias, e.automatico, e.para, e.assunto, e.status, e.erro, e.criado_em AS "criadoEm", e.enviado_em AS "enviadoEm", u.nome AS "criadoPor"
         FROM envio_email e JOIN fatura f ON f.id = e.fatura_id JOIN cliente cl ON cl.id = e.cliente_id LEFT JOIN usuario u ON u.id = e.criado_por
        WHERE e.empresa_id = $1 AND ($2::uuid IS NULL OR e.fatura_id = $2) ORDER BY e.criado_em DESC LIMIT 150`, [empresaId, faturaId ?? null])).rows);
  }

  /** Monta e envia uma mensagem de cobrança com a fatura em PDF e registra o resultado. Devolve null se esse aviso automático já saiu. */
  private async enviarUm(c: PoolClient, ctx: { grupoId: string; usuarioId: string | null }, faturaId: string, tipo: TipoEmail, diasAviso: number, opcoes: { automatico: boolean; para?: string[]; copiaPara?: string | null }) {
    const f = (await c.query(
      `SELECT f.id, f.empresa_id AS "empresaId", f.cliente_id AS "clienteId", f.numero::int AS numero, f.vencimento::text AS vencimento, f.status, cl.nome AS cliente, cl.emails_cobranca AS emails, e.nome_fantasia AS loja, e.email_financeiro AS "emailLoja"
         FROM fatura f JOIN cliente cl ON cl.id = f.cliente_id JOIN empresa e ON e.id = f.empresa_id WHERE f.id = $1`, [faturaId])).rows[0];
    if (!f) throw new NotFoundException('Fatura não encontrada.');
    const para = (opcoes.para ?? f.emails as string[]).filter(emailOk);
    const hoje = hojeSP(); const atraso = -dias(f.vencimento, hoje);
    const assunto = tipo === 'ATRASO' ? `Fatura nº ${f.numero} vencida há ${atraso} ${atraso === 1 ? 'dia' : 'dias'} (${f.loja})`
      : tipo === 'LEMBRETE' ? `Lembrete: a fatura nº ${f.numero} vence em ${br(f.vencimento)} (${f.loja})` : `Fatura nº ${f.numero}, vencimento ${br(f.vencimento)} (${f.loja})`;
    const ins = await c.query(
      `INSERT INTO envio_email (grupo_id, empresa_id, fatura_id, cliente_id, tipo, dias, automatico, para, assunto, status, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (fatura_id, tipo, dias) WHERE automatico DO NOTHING RETURNING id`,
      [ctx.grupoId, f.empresaId, f.id, f.clienteId, tipo, diasAviso, opcoes.automatico, para, assunto, para.length ? 'PENDENTE' : 'SEM_DESTINATARIO', ctx.usuarioId]);
    if (!ins.rowCount) return null;
    const id = ins.rows[0].id as string;
    if (!para.length) { await c.query(`UPDATE envio_email SET erro = $2 WHERE id = $1`, [id, 'O cliente não tem e-mail de cobrança cadastrado.']); return { id, status: 'SEM_DESTINATARIO', erro: 'O cliente não tem e-mail de cobrança cadastrado.' }; }

    const arq = await this.faturas.pdfInterno(c, f.id);
    const d = arq.dados;
    const linhas = [`Olá!`, ``, tipo === 'ATRASO' ? `A fatura nº ${f.numero} de ${f.loja} está vencida desde ${br(f.vencimento)}.` : tipo === 'LEMBRETE' ? `Este é um lembrete: a fatura nº ${f.numero} de ${f.loja} vence em ${br(f.vencimento)}.` : `Segue a fatura nº ${f.numero} de ${f.loja}, com vencimento em ${br(f.vencimento)}.`, ``,
      `Valor em aberto${d.encargosCentavos > 0 ? ' (com multa e juros de hoje)' : ''}: ${formatarBRL(d.totalHojeCentavos)}`];
    if (d.pix) linhas.push(``, `Pague por PIX (copia e cola):`, d.pix.copiaECola);
    for (const ct of d.contas.slice(0, 2)) linhas.push(``, `Dados para pagamento: ${[ct.banco, ct.agencia ? `ag. ${ct.agencia}` : '', ct.conta ? `conta ${ct.conta}` : '', ct.titular].filter(Boolean).join(' · ')}`);
    linhas.push(``, `A fatura em PDF está anexada. Se você já pagou, desconsidere esta mensagem.`, ``, f.loja);
    const regua = await this.lerRegua(c, f.empresaId);
    const r = await this.mailer.enviar({ para, cc: (opcoes.copiaPara ?? regua.copiaPara) ? [(opcoes.copiaPara ?? regua.copiaPara)!] : undefined, responderPara: f.emailLoja ?? undefined, assunto, texto: linhas.join('\n'), anexos: [{ nome: arq.nome, conteudo: arq.pdf, tipo: 'application/pdf' }] });
    const status = r.ok ? 'ENVIADO' : r.configurado ? 'ERRO' : 'SEM_CONFIGURACAO';
    await c.query(`UPDATE envio_email SET status = $2::status_email, erro = $3, enviado_em = CASE WHEN $2::text = 'ENVIADO' THEN now() END WHERE id = $1`, [id, status, r.ok ? null : r.erro]);
    return { id, status, erro: r.ok ? null : r.erro };
  }

  /** Envio manual de uma fatura, pelo botão da tela. */
  async enviarFatura(a: Acesso, faturaId: string, para?: string[]) {
    return this.db.tenant(contextoDb(a), async (c) => {
      const f = (await c.query('SELECT empresa_id AS "empresaId", numero::int AS numero, status FROM fatura WHERE id = $1', [faturaId])).rows[0];
      if (!f) throw new NotFoundException('Fatura não encontrada.');
      exigir(a, 'fatura.gerar', f.empresaId);
      if (f.status === 'CANCELADA') throw new UnprocessableEntityException({ mensagem: 'Fatura cancelada não é enviada.', campos: {} });
      if (para?.some((e) => !emailOk(e))) throw new UnprocessableEntityException({ mensagem: 'Confira os e-mails informados.', campos: { para: 'E-mail inválido.' } });
      const r = await this.enviarUm(c, a, faturaId, 'MANUAL', 0, { automatico: false, para });
      await auditar(c, a, { acao: 'cobranca.email_manual', entidade: 'fatura', entidadeId: faturaId, empresaId: f.empresaId, depois: { fatura: f.numero, status: r?.status } });
      return r;
    });
  }

  /** A régua de uma loja hoje: fatura nova, lembretes antes do vencimento e avisos de atraso. Cada aviso sai uma única vez por fatura. */
  async processarEmpresa(c: PoolClient, ctx: { grupoId: string; usuarioId: string | null }, empresaId: string, hoje = hojeSP()) {
    const regua = await this.lerRegua(c, empresaId);
    const res = { avaliadas: 0, enviados: 0, semConfiguracao: 0, semDestinatario: 0, erros: 0 };
    if (!regua.ativa) return { ...res, ativa: false };
    const faturas = (await c.query(`SELECT id, vencimento::text AS vencimento, emissao::text AS emissao FROM fatura WHERE empresa_id = $1 AND status IN ('ABERTA','PARCIAL') ORDER BY vencimento`, [empresaId])).rows as { id: string; vencimento: string; emissao: string }[];
    for (const f of faturas) {
      res.avaliadas++;
      const faltam = dias(f.vencimento, hoje);
      const avisos: { tipo: TipoEmail; dias: number }[] = [];
      if (regua.enviarAoGerar) avisos.push({ tipo: 'FATURA', dias: 0 });
      if (faltam > 0 && regua.diasAntes.includes(faltam)) avisos.push({ tipo: 'LEMBRETE', dias: faltam });
      if (faltam < 0 && regua.diasApos.includes(-faltam)) avisos.push({ tipo: 'ATRASO', dias: -faltam });
      for (const av of avisos) {
        await c.query('SAVEPOINT aviso'); // um aviso com problema não derruba os outros
        try {
          const r = await this.enviarUm(c, ctx, f.id, av.tipo, av.dias, { automatico: true });
          await c.query('RELEASE SAVEPOINT aviso');
          if (!r) continue;
          if (r.status === 'ENVIADO') res.enviados++; else if (r.status === 'SEM_CONFIGURACAO') res.semConfiguracao++; else if (r.status === 'SEM_DESTINATARIO') res.semDestinatario++; else res.erros++;
        } catch (e) { await c.query('ROLLBACK TO SAVEPOINT aviso'); res.erros++; this.log.error(`Fatura ${f.id}: ${(e as Error).message}`); }
      }
    }
    await auditar(c, { grupoId: ctx.grupoId, usuarioId: ctx.usuarioId }, { acao: 'cobranca.processada', entidade: 'regua_cobranca', entidadeId: empresaId, empresaId, depois: res });
    return { ...res, ativa: true };
  }

  /** "Enviar cobranças agora", para a loja ativa. */
  async processar(a: Acesso) {
    const empresaId = this.empresaAtiva(a);
    exigir(a, 'regua_cobranca.editar', empresaId);
    return this.db.tenant(contextoDb(a), (c) => this.processarEmpresa(c, a, empresaId));
  }

  /** Todas as lojas de todos os grupos ativos. Chamado pelo agendador diário. */
  async processarTodas(hoje = hojeSP()) {
    const grupos = (await this.db.semTenant((c) => c.query(`SELECT id FROM bo_listar_grupos() WHERE status = 'ATIVO'`))).rows as { id: string }[];
    let enviados = 0;
    for (const g of grupos) {
      const ctx: ContextoDb = { grupoId: g.id, rede: true, empresas: [] };
      try {
        await this.db.tenant(ctx, async (c) => {
          const lojas = (await c.query(`SELECT e.id FROM empresa e JOIN regua_cobranca r ON r.empresa_id = e.id AND r.ativa WHERE e.status = 'ATIVO'`)).rows as { id: string }[];
          for (const l of lojas) enviados += (await this.processarEmpresa(c, { grupoId: g.id, usuarioId: null }, l.id, hoje)).enviados;
        });
      } catch (e) { this.log.error(`Grupo ${g.id}: ${(e as Error).message}`); }
    }
    return { grupos: grupos.length, enviados };
  }
}
