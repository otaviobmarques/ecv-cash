import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { hojeSP } from '../caixa/razao';
import { CobrancaService } from './cobranca.service';
import { AssinaturaService } from '../assinatura/assinatura.service';
import { DbService } from '../db/db.service';

/**
 * Roda a régua de cobrança uma vez por dia, na hora configurada (horário de Brasília). Ligue (AGENDADOR=true) em um único processo da API.
 * Mesmo que dois processos rodem, o banco impede o mesmo aviso de sair duas vezes para a mesma fatura.
 */
@Injectable()
export class AgendadorCobranca implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Agendador');
  private timer?: NodeJS.Timeout;
  private ultimoDia = '';
  constructor(private readonly cobranca: CobrancaService, private readonly assinaturas: AssinaturaService, private readonly db: DbService, @Inject(ENV) private readonly env: Env) {}

  onApplicationBootstrap() {
    if (this.env.AGENDADOR !== 'true') return;
    this.log.log(`Régua de cobrança agendada para ${this.env.HORA_COBRANCA}h (Brasília).`);
    this.timer = setInterval(() => void this.tique(), 10 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tique() {
    const hora = Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
    const hoje = hojeSP();
    if (hora < this.env.HORA_COBRANCA || this.ultimoDia === hoje) return;
    this.ultimoDia = hoje;
    if (!(await this.rodarDia(hoje)).reguaOk) this.ultimoDia = '';
  }

  /**
   * A rotina do dia: limpeza, mensalidades do SaaS e régua de cobrança. Chamada pelo relógio interno (VPS)
   * ou pelo Vercel Cron (`GET /interno/agendador`). Rodar duas vezes no mesmo dia não duplica nada (índices únicos).
   */
  async rodarDia(hoje = hojeSP()) {
    await this.limpar();
    const r = { hoje, mensalidades: 0, emails: 0, assinaturasOk: true, reguaOk: true };
    try { const a = await this.assinaturas.processarTodas(hoje); r.mensalidades = a.geradas; this.log.log(`Assinaturas: ${a.geradas} mensalidades geradas em ${a.grupos} grupos.`); }
    catch (e) { r.assinaturasOk = false; this.log.error(`Assinaturas falharam: ${(e as Error).message}`); }
    try { const c = await this.cobranca.processarTodas(hoje); r.emails = c.enviados; this.log.log(`Régua rodou: ${c.enviados} e-mails em ${c.grupos} grupos.`); }
    catch (e) { r.reguaOk = false; this.log.error(`Régua falhou: ${(e as Error).message}`); }
    return r;
  }

  /** Dado técnico que não precisa ficar: tentativas de login com mais de 90 dias. (O log de auditoria, por lei e por desenho, não se apaga.) */
  private async limpar() {
    try { const r = await this.db.semTenant((c) => c.query(`DELETE FROM login_tentativa WHERE criado_em < now() - interval '90 days'`)); if (r.rowCount) this.log.log(`${r.rowCount} tentativas de login antigas removidas.`); }
    catch (e) { this.log.warn(`Limpeza de tentativas de login falhou: ${(e as Error).message}`); }
  }
}
