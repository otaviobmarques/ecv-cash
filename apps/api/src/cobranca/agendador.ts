import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { hojeSP } from '../caixa/razao';
import { CobrancaService } from './cobranca.service';

/**
 * Roda a régua de cobrança uma vez por dia, na hora configurada (horário de Brasília). Ligue (AGENDADOR=true) em um único processo da API.
 * Mesmo que dois processos rodem, o banco impede o mesmo aviso de sair duas vezes para a mesma fatura.
 */
@Injectable()
export class AgendadorCobranca implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Agendador');
  private timer?: NodeJS.Timeout;
  private ultimoDia = '';
  constructor(private readonly cobranca: CobrancaService, @Inject(ENV) private readonly env: Env) {}

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
    try { const r = await this.cobranca.processarTodas(hoje); this.log.log(`Régua rodou: ${r.enviados} e-mails em ${r.grupos} grupos.`); }
    catch (e) { this.ultimoDia = ''; this.log.error(`Régua falhou: ${(e as Error).message}`); }
  }
}
