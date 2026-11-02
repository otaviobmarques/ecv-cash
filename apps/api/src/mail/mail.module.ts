import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { Mailer, MailerConsole, MailerSmtp } from './mailer';

@Global()
@Module({
  providers: [{ provide: Mailer, useFactory: (env: Env) => (env.SMTP_HOST ? new MailerSmtp(env) : new MailerConsole()), inject: [ENV] }],
  exports: [Mailer],
})
export class MailModule {}
