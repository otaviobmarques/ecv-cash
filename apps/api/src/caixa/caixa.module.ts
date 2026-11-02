import { Module } from '@nestjs/common';
import { CaixaController } from './caixa.controller';
import { CaixaService } from './caixa.service';

@Module({ controllers: [CaixaController], providers: [CaixaService], exports: [CaixaService] })
export class CaixaModule {}
