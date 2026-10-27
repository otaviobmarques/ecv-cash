import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DbService } from '../db/db.service';

const MAX_FALHAS = 5;
const JANELA_MIN = 15;

/** Bloqueio por força bruta, compartilhado pelo login dos clientes e do backoffice. A chave é o hash do e-mail. */
@Injectable()
export class Tentativas {
  constructor(private readonly db: DbService) {}

  chave(escopo: string, email: string) {
    return `${escopo}:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`;
  }

  async exigirSemBloqueio(chave: string) {
    const falhas = await this.db.semTenant(async (c) =>
      Number((await c.query(
        `SELECT count(*) AS n FROM login_tentativa
          WHERE chave = $1 AND NOT sucesso AND criado_em > now() - make_interval(mins => $2)
            AND criado_em > coalesce((SELECT max(criado_em) FROM login_tentativa WHERE chave = $1 AND sucesso), '-infinity')`,
        [chave, JANELA_MIN],
      )).rows[0].n),
    );
    if (falhas >= MAX_FALHAS) throw new HttpException('Muitas tentativas. Tente de novo em alguns minutos.', HttpStatus.TOO_MANY_REQUESTS);
  }

  registrar(chave: string, ip: string | undefined, sucesso: boolean) {
    return this.db.semTenant((c) => c.query('INSERT INTO login_tentativa (chave, ip, sucesso) VALUES ($1,$2,$3)', [chave, ip ?? null, sucesso]));
  }
}
