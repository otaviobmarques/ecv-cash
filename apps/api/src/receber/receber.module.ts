import { Module } from '@nestjs/common';
import { ReceberController } from './receber.controller';
import { ReceberService } from './receber.service';

@Module({ controllers: [ReceberController], providers: [ReceberService], exports: [ReceberService] })
export class ReceberModule {}
