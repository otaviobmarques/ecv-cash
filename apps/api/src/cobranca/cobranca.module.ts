import { Module } from '@nestjs/common';
import { FaturasModule } from '../faturas/faturas.module';
import { CobrancaController } from './cobranca.controller';
import { CobrancaService } from './cobranca.service';
import { AgendadorCobranca } from './agendador';

@Module({ imports: [FaturasModule], controllers: [CobrancaController], providers: [CobrancaService, AgendadorCobranca], exports: [CobrancaService] })
export class CobrancaModule {}
