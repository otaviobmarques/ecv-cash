import { Module } from '@nestjs/common';
import { CartaoController } from './cartao.controller';
import { CartaoService } from './cartao.service';
import { ChequesController } from '../cheques/cheques.controller';
import { ChequesService } from '../cheques/cheques.service';

@Module({ controllers: [CartaoController, ChequesController], providers: [CartaoService, ChequesService] })
export class CartaoModule {}
