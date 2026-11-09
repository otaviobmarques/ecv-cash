import { Module } from '@nestjs/common';
import { FaturasModule } from '../faturas/faturas.module';
import { CobrancaController } from './cobranca.controller';
import { CobrancaService } from './cobranca.service';
import { AssinaturaModule } from '../assinatura/assinatura.module';
import { AgendadorCobranca } from './agendador';
import { AgendadorController } from './agendador.controller';

@Module({ imports: [FaturasModule, AssinaturaModule], controllers: [CobrancaController, AgendadorController], providers: [CobrancaService, AgendadorCobranca], exports: [CobrancaService] })
export class CobrancaModule {}
