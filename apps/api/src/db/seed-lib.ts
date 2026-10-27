import { randomUUID } from 'node:crypto';
import type { DbService } from './db.service';
import { hashSenha } from '../auth/senha';

export interface SeedEmpresa { nome: string; cnpj: string }
export interface SeedUsuario { nome: string; email: string; senha: string; perfil: 'ADMINISTRATIVO' | 'GERENTE' | 'FINANCEIRO' | 'VISTORIADOR'; lojas?: number[] }

/**
 * Cria um grupo com empresas e usuários. É o mesmo caminho que o backoffice vai usar para abrir um
 * cliente novo: o grupo nasce com o próprio id no contexto, sem nenhum acesso especial ao banco.
 */
export async function criarGrupoCompleto(db: DbService, o: { nome: string; empresas: SeedEmpresa[]; usuarios: SeedUsuario[] }) {
  const grupoId = randomUUID();
  const usuarioIds: string[] = [];
  const hashes = await Promise.all(o.usuarios.map((u) => hashSenha(u.senha)));
  const empresaIds = await db.tenant({ grupoId, rede: true, empresas: [] }, async (c) => {
    await c.query('INSERT INTO grupo (id, nome) VALUES ($1,$2)', [grupoId, o.nome]);
    const ids: string[] = [];
    for (const e of o.empresas) {
      const id = randomUUID();
      await c.query(
        `INSERT INTO empresa (id, grupo_id, cnpj, razao_social, nome_fantasia, uf, cidade, regime)
         VALUES ($1,$2,$3,$4,$5,'SP','São Paulo','SIMPLES_NACIONAL')`,
        [id, grupoId, e.cnpj, `${e.nome} Vistorias Ltda`, e.nome],
      );
      ids.push(id);
    }
    for (const [i, u] of o.usuarios.entries()) {
      const id = randomUUID();
      usuarioIds.push(id);
      await c.query(
        'INSERT INTO usuario (id, grupo_id, nome, email, senha_hash, acesso_rede) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, grupoId, u.nome, u.email, hashes[i], u.perfil === 'ADMINISTRATIVO'],
      );
      if (u.perfil !== 'ADMINISTRATIVO') {
        for (const idx of u.lojas ?? []) {
          await c.query('INSERT INTO usuario_empresa_perfil (usuario_id, empresa_id, grupo_id, perfil) VALUES ($1,$2,$3,$4)', [id, ids[idx], grupoId, u.perfil]);
        }
      }
    }
    return ids;
  });
  return { grupoId, empresaIds, usuarioIds };
}
