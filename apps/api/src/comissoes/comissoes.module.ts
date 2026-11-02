import { Module } from '@nestjs/common';
import { ComissoesController } from './comissoes.controller';
import { ComissoesService } from './comissoes.service';

@Module({ controllers: [ComissoesController], providers: [ComissoesService] })
export class ComissoesModule {}
