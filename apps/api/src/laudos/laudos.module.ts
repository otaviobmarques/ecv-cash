import { Module } from '@nestjs/common';
import { CadastrosModule } from '../cadastros/cadastros.module';
import { LaudosController } from './laudos.controller';
import { LaudosService } from './laudos.service';

@Module({ imports: [CadastrosModule], controllers: [LaudosController], providers: [LaudosService] })
export class LaudosModule {}
