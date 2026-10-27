import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { podeCriarUsuario, type CriarUsuario, type Perfil } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { ENV, Env } from '../config/env';
import { Acesso, contextoDb } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { Mailer } from '../mail/mailer';
import { novoToken, sha256 } from '../auth/senha';
import { randomUUID } from 'node:crypto';

@Injectable()
export class UsuariosService {
  constructor(private readonly db: DbService, private readonly mailer: Mailer, @Inject(ENV) private readonly env: Env) {}

  listar(a: Acesso) {
    return this.db.tenant(contextoDb(a), async (c) =>
      (await c.query(
        `SELECT u.id, u.nome, u.email, u.status, u.acesso_rede AS "acessoRede", (u.senha_hash IS NULL) AS "convitePendente",
                coalesce(json_agg(json_build_object('empresaId', p.empresa_id, 'perfil', p.perfil)) FILTER (WHERE p.usuario_id IS NOT NULL), '[]') AS lotacoes
           FROM usuario u LEFT JOIN usuario_empresa_perfil p ON p.usuario_id = u.id
          GROUP BY u.id ORDER BY u.nome`,
      )).rows,
    );
  }

  async criar(a: Acesso, dto: CriarUsuario) {
    const perfilPorEmpresa = Object.fromEntries(a.empresas.map((e) => [e.id, e.perfil])) as Record<string, Perfil>;
    const adm = dto.perfil === 'ADMINISTRATIVO';
    const regra = podeCriarUsuario({ rede: a.rede, perfilPorEmpresa }, { perfil: dto.perfil, empresaIds: adm ? [] : dto.empresaIds });
    if (!regra.ok) throw new ForbiddenException(regra.motivo);
    if (!adm && dto.empresaIds.length === 0) throw new BadRequestException('Escolha ao menos uma loja.');

    const id = randomUUID();
    const token = novoToken();
    const link = `${this.env.URL_APP}/convite?token=${token}`;
    await this.db.tenant(contextoDb(a), async (c) => {
      if (!adm) {
        const n = Number((await c.query('SELECT count(*) AS n FROM empresa WHERE id = ANY($1::uuid[]) AND status = $2', [dto.empresaIds, 'ATIVO'])).rows[0].n);
        if (n !== new Set(dto.empresaIds).size) throw new BadRequestException('Uma das lojas não existe ou está inativa.');
      }
      try {
        // sem RETURNING: o usuário só fica visível ao Gerente depois de receber a lotação
        await c.query(
          `INSERT INTO usuario (id, grupo_id, nome, email, acesso_rede, convite_hash, convite_expira_em)
           VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')`,
          [id, a.grupoId, dto.nome, dto.email, adm, sha256(token)],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe um usuário com este e-mail.');
        throw e;
      }
      if (!adm) {
        for (const empresaId of new Set(dto.empresaIds)) {
          await c.query('INSERT INTO usuario_empresa_perfil (usuario_id, empresa_id, grupo_id, perfil) VALUES ($1,$2,$3,$4)', [id, empresaId, a.grupoId, dto.perfil]);
        }
      }
      await auditar(c, a, {
        acao: 'usuario.criado', entidade: 'usuario', entidadeId: id, empresaId: dto.empresaIds[0] ?? null,
        depois: { nome: dto.nome, email: dto.email, perfil: dto.perfil, empresaIds: dto.empresaIds },
      });
    });
    await this.mailer.enviarConvite(dto.email, dto.nome, link);
    return { id, ...(this.env.EXPOR_CONVITE === 'true' ? { conviteLink: link } : {}) };
  }

  /** Na fundação só o Administrativo ativa e inativa usuários; o Gerente ganha "remover da loja" no módulo de cadastros. */
  async alterarStatus(a: Acesso, id: string, status: 'ATIVO' | 'INATIVO', motivo?: string) {
    if (!a.rede) throw new ForbiddenException('Só o Administrativo ativa ou inativa usuários.');
    if (id === a.usuarioId) throw new BadRequestException('Você não pode alterar o seu próprio acesso.');
    return this.db.tenant(contextoDb(a), async (c) => {
      const antes = (await c.query('SELECT id, status FROM usuario WHERE id = $1', [id])).rows[0];
      if (!antes) throw new NotFoundException('Usuário não encontrado.');
      await c.query('UPDATE usuario SET status = $2 WHERE id = $1', [id, status]);
      await auditar(c, a, { acao: status === 'INATIVO' ? 'usuario.inativado' : 'usuario.reativado', entidade: 'usuario', entidadeId: id, antes, depois: { status }, motivo });
      return { id, status };
    });
  }
}
