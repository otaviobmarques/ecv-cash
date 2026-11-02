import { Module } from '@nestjs/common';
import { AssinaturaService } from './assinatura.service';

/** Os controllers ficam no AppModule, junto do BoGuard e do AcessoGuard de que dependem. */
@Module({ providers: [AssinaturaService], exports: [AssinaturaService] })
export class AssinaturaModule {}
