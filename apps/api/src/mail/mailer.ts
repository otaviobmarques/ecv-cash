import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface MensagemEmail {
  para: string[]; cc?: string[]; responderPara?: string;
  assunto: string; texto: string; html?: string;
  anexos?: { nome: string; conteudo: Buffer; tipo: string }[];
}
export type ResultadoEnvio = { ok: true } | { ok: false; configurado: boolean; erro: string };

export abstract class Mailer {
  abstract readonly configurado: boolean;
  abstract enviar(m: MensagemEmail): Promise<ResultadoEnvio>;
  abstract enviarConvite(para: string, nome: string, link: string): Promise<void>;
}

/** Sem servidor de e-mail configurado: nada sai, e quem pediu fica sabendo (o pedido é registrado como "sem configuração"). */
@Injectable()
export class MailerConsole extends Mailer {
  readonly configurado = false;
  private readonly log = new Logger('Mailer');
  async enviar(m: MensagemEmail): Promise<ResultadoEnvio> {
    this.log.warn(`E-mail não enviado (SMTP não configurado): "${m.assunto}" para ${m.para.length} destinatário(s)`);
    return { ok: false, configurado: false, erro: 'O envio de e-mail não está configurado neste ambiente.' };
  }
  async enviarConvite(para: string, nome: string, _link: string) {
    this.log.log(`Convite para ${nome} <${para}> (link omitido do log; SMTP não configurado)`);
  }
}

@Injectable()
export class MailerSmtp extends Mailer {
  readonly configurado = true;
  private readonly log = new Logger('Mailer');
  private readonly transporte: Transporter;
  constructor(private readonly env: Env) {
    super();
    this.transporte = createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000, socketTimeout: 30_000,
    });
  }
  async enviar(m: MensagemEmail): Promise<ResultadoEnvio> {
    try {
      await this.transporte.sendMail({
        from: this.env.SMTP_FROM, to: m.para, cc: m.cc, replyTo: m.responderPara, subject: m.assunto, text: m.texto, html: m.html,
        attachments: m.anexos?.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.tipo })),
      });
      return { ok: true };
    } catch (e) {
      this.log.warn(`Falha ao enviar "${m.assunto}": ${(e as Error).message}`);
      return { ok: false, configurado: true, erro: 'O servidor de e-mail recusou ou não respondeu. Tente de novo mais tarde.' };
    }
  }
  async enviarConvite(para: string, nome: string, link: string) {
    const r = await this.enviar({
      para: [para], assunto: 'Seu convite para o ECV Cash',
      texto: `Olá, ${nome}.\n\nVocê foi convidado para usar o ECV Cash. Crie sua senha pelo link abaixo (vale por 7 dias e só pode ser usado uma vez):\n\n${link}\n\nSe você não esperava este convite, ignore esta mensagem.`,
      html: `<p>Olá, ${nome.replace(/[<>&]/g, '')}.</p><p>Você foi convidado para usar o <b>ECV Cash</b>. Crie sua senha pelo link abaixo (vale por 7 dias e só pode ser usado uma vez):</p><p><a href="${link}">${link}</a></p><p>Se você não esperava este convite, ignore esta mensagem.</p>`,
    });
    if (!r.ok) this.log.warn(`Convite para ${para} não foi enviado: ${r.erro}`);
  }
}
