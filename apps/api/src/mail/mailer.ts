import { Injectable, Logger } from '@nestjs/common';

export abstract class Mailer {
  abstract enviarConvite(para: string, nome: string, link: string): Promise<void>;
}

/** Até haver envio real (Fase 2), o convite só vai para o log do servidor. */
@Injectable()
export class MailerConsole extends Mailer {
  private readonly log = new Logger('Mailer');
  async enviarConvite(para: string, nome: string, _link: string) {
    this.log.log(`Convite para ${nome} <${para}> (link omitido do log)`);
  }
}
