import { Module } from '@nestjs/common';
import { LgpdController } from './lgpd.controller';
import { LgpdService } from './lgpd.service';

@Module({ controllers: [LgpdController], providers: [LgpdService] })
export class LgpdModule {}
