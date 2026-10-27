import { Global, Module } from '@nestjs/common';
import { Mailer, MailerConsole } from './mailer';

@Global()
@Module({ providers: [{ provide: Mailer, useClass: MailerConsole }], exports: [Mailer] })
export class MailModule {}
