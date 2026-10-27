import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { ROTULO_PERFIL } from '@ecv/shared';
import { Pilula } from '@ecv/ui';
import { api } from '../api';
import type { Empresa, Eu, UsuarioItem } from '../tipos';

export function Inicio() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const podeUsuarios = eu.permissoes.includes('usuario.gerir');
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get<UsuarioItem[]>('/usuarios'), enabled: podeUsuarios });
  const ativa = empresas.find((e) => e.id === eu.empresaAtivaId);

  return (
    <div className="pilha estreito">
      <div className="cabeca">
        <div>
          <h1>Olá, {eu.nome.split(' ')[0]}</h1>
          <p className="mut">{ativa ? <>Você está em <b>{ativa.nomeFantasia}</b>.</> : 'Você ainda não tem uma loja atribuída.'}</p>
        </div>
        {eu.perfilAtivo && <Pilula tipo="ok">{ROTULO_PERFIL[eu.perfilAtivo]}</Pilula>}
      </div>
      <div className="grade g3">
        <div className="cartao"><div className="mut peq">Empresas acessíveis</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--verde)' }}>{empresas.length}</div></div>
        {podeUsuarios && <div className="cartao"><div className="mut peq">Usuários</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--verde)' }}>{usuarios.data?.length ?? '…'}</div></div>}
        <div className="cartao"><div className="mut peq">Convites pendentes</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--verde)' }}>{podeUsuarios ? usuarios.data?.filter((u) => u.convitePendente).length ?? '…' : '—'}</div></div>
      </div>
      <div className="cartao pilha">
        <h2>O que já está disponível</h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li><Link to="/empresas">Empresas</Link>: cadastro e consulta das lojas do grupo.</li>
          {podeUsuarios && <li><Link to="/usuarios">Usuários</Link>: convide pessoas e defina o perfil de cada uma por loja.</li>}
          {eu.permissoes.includes('tema.editar') && <li><Link to="/aparencia">Aparência</Link>: a cor da sua marca no sistema.</li>}
          {eu.permissoes.includes('auditoria.ver') && <li><Link to="/auditoria">Auditoria</Link>: quem fez o quê e quando.</li>}
        </ul>
        <p className="mut peq">Laudos, contas a receber, faturados, contas a pagar e caixa chegam nos próximos módulos.</p>
      </div>
    </div>
  );
}
