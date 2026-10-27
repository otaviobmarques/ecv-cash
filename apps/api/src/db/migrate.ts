import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/** Aplica as migrações SQL em ordem, cada uma em transação, como ecv_owner. */
export async function migrar(urlDono: string, pasta = join(__dirname, '../../db/migrations')): Promise<string[]> {
  const c = new Client({ connectionString: urlDono });
  await c.connect();
  const aplicadas: string[] = [];
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migracao (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    const feitas = new Set((await c.query<{ nome: string }>('SELECT nome FROM schema_migracao')).rows.map((r) => r.nome));
    for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
      if (feitas.has(arquivo)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(join(pasta, arquivo), 'utf8'));
        await c.query('INSERT INTO schema_migracao (nome) VALUES ($1)', [arquivo]);
        await c.query('COMMIT');
        aplicadas.push(arquivo);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falha na migração ${arquivo}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
  return aplicadas;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('Defina DATABASE_URL_OWNER.');
  migrar(url).then((a) => console.log(a.length ? `Migrações aplicadas: ${a.join(', ')}` : 'Banco já está atualizado.'));
}
