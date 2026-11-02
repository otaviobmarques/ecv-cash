import { Module } from '@nestjs/common';
import { BalancoController } from './balanco.controller';
import { SaldosService } from './saldos.service';

@Module({ controllers: [BalancoController], providers: [SaldosService] })
export class BalancoModule {}
