import 'reflect-metadata';
import { DbService } from './db.service';
import { criarGrupoCompleto } from './seed-lib';
import { carregarEnv } from '../config/env';

/** Dados de desenvolvimento. Nunca rodar em produção: as senhas são conhecidas. */
async function main() {
  const env = carregarEnv();
  if (env.NODE_ENV === 'production') throw new Error('Seed não roda em produção.');
  const db = new DbService(env);
  const r = await criarGrupoCompleto(db, {
    nome: 'Rede Vistoria Sul (exemplo)',
    empresas: [
      { nome: 'Loja Centro', cnpj: '11222333000181' },
      { nome: 'Loja Norte', cnpj: '11444777000161' },
    ],
    usuarios: [
      { nome: 'Marina Alves', email: 'admin@exemplo.local', senha: 'Senha-de-teste-1', perfil: 'ADMINISTRATIVO' },
      { nome: 'Rafael Costa', email: 'gerente@exemplo.local', senha: 'Senha-de-teste-1', perfil: 'GERENTE', lojas: [0] },
      { nome: 'Juliana Prado', email: 'financeiro@exemplo.local', senha: 'Senha-de-teste-1', perfil: 'FINANCEIRO', lojas: [0] },
      { nome: 'Ana Souza', email: 'vistoriador@exemplo.local', senha: 'Senha-de-teste-1', perfil: 'VISTORIADOR', lojas: [0] },
    ],
  });
  console.log('Grupo criado:', r.grupoId);
  await db.onModuleDestroy();
}
main();
