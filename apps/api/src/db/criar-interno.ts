import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { PAPEIS_INTERNOS } from '@ecv/shared';
import { hashSenha } from '../auth/senha';

/**
 * Cria um usuário da equipe interna (backoffice) e imprime uma senha provisória uma única vez.
 * No primeiro login a pessoa configura o aplicativo autenticador (2FA).
 * Uso: DATABASE_URL_OWNER=... pnpm --filter @ecv/api bo:criar-interno "Nome" email@dominio PLATAFORMA
 */
async function main() {
  const [nome, email, papel = 'PLATAFORMA'] = process.argv.slice(2);
  const url = process.env.DATABASE_URL_OWNER;
  if (!nome || !email || !url) throw new Error('Uso: bo:criar-interno "Nome" email [PLATAFORMA|OPERACOES|SUPORTE] (com DATABASE_URL_OWNER definida)');
  if (!(PAPEIS_INTERNOS as readonly string[]).includes(papel)) throw new Error(`Papel inválido. Use: ${PAPEIS_INTERNOS.join(', ')}`);
  const senha = randomBytes(12).toString('base64url');
  const pool = new Pool({ connectionString: url });
  await pool.query('INSERT INTO usuario_interno (nome, email, senha_hash, papel) VALUES ($1,$2,$3,$4)', [nome, email.toLowerCase(), await hashSenha(senha), papel]);
  await pool.end();
  console.log(`Usuário interno criado: ${email} (${papel})\nSenha provisória (anote agora, não será exibida de novo): ${senha}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
