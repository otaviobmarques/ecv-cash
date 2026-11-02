import { Module } from '@nestjs/common';
import { CadastrosModule } from '../cadastros/cadastros.module';
import { ImportacaoController } from './importacao.controller';
import { ImportacaoService } from './importacao.service';

@Module({ imports: [CadastrosModule], controllers: [ImportacaoController], providers: [ImportacaoService] })
export class ImportacaoModule {}
