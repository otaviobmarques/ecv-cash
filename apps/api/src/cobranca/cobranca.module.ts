import { Module } from '@nestjs/common';
import { FaturasModule } from '../faturas/faturas.module';
import { CobrancaController } from './cobranca.controller';
import { CobrancaService } from './cobranca.service';
import { AssinaturaModule } from '../assinatura/assinatura.module';
import { AgendadorCobranca } from './agendador';

@Module({ imports: [FaturasModule, AssinaturaModule], controllers: [CobrancaController], providers: [CobrancaService, AgendadorCobranca], exports: [CobrancaService] })
export class CobrancaModule {}
