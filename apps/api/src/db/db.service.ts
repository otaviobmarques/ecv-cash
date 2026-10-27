import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ENV, Env } from '../config/env';

/** O que o banco precisa saber para isolar os dados desta requisição (ver migração 0002). */
export interface ContextoDb {
  grupoId: string;
  usuarioId?: string;
  rede: boolean;
  empresas: string[];
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }

  /** Executa `fn` numa transação com o contexto de grupo e lojas aplicado. Sem contexto, nenhuma linha aparece. */
  async tenant<T>(ctx: ContextoDb, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `SELECT set_config('app.grupo_id', $1, true), set_config('app.usuario_id', $2, true),
                set_config('app.rede', $3, true), set_config('app.empresas', $4, true)`,
        [ctx.grupoId, ctx.usuarioId ?? '', ctx.rede ? 'on' : 'off', ctx.empresas.join(',')],
      );
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** Para o que acontece antes de o grupo ser conhecido (login, tentativas, funções de login). */
  async semTenant<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
