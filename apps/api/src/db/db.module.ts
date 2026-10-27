import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { ENV, carregarEnv } from '../config/env';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => carregarEnv() }, DbService],
  exports: [DbService, ENV],
})
export class DbModule {}
