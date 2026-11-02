import { Module } from '@nestjs/common';
import { FaturasController } from './faturas.controller';
import { FaturasService } from './faturas.service';

@Module({ controllers: [FaturasController], providers: [FaturasService], exports: [FaturasService] })
export class FaturasModule {}
