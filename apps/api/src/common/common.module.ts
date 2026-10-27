import { Global, Module } from '@nestjs/common';
import { Tentativas } from './tentativas';

@Global()
@Module({ providers: [Tentativas], exports: [Tentativas] })
export class CommonModule {}
