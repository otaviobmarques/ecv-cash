import { Module } from '@nestjs/common';
import { PagarController } from './pagar.controller';
import { PagarService } from './pagar.service';

@Module({ controllers: [PagarController], providers: [PagarService], exports: [PagarService] })
export class PagarModule {}
