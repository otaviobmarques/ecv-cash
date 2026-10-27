import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Publico } from '../common/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Publico() @Get()
  async saude() {
    await this.db.semTenant((c) => c.query('SELECT 1'));
    return { status: 'ok' };
  }
}
