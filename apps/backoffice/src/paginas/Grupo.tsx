import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ROTULO_PERFIL, formatarCnpj, type Perfil } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Dialogo, Pilula, formatarDataHora, useToast } from '@ecv/ui';
import { api } from '../api';
import { useInterno } from '../sessao';
import type { EventoGrupo, GrupoDetalhe } from '../tipos';
import { PILULA_GRUPO } from './Grupos';
import { AssinaturaGrupo } from './AssinaturaGrupo';

type Acao = { tipo: 'status' } | { tipo: 'entrar' } | { tipo: 'redefinir'; id: string; nome: string };
const ACOES: Record<string, string> = {
  'grupo.criado': 'Grupo criado', 'grupo.suspenso': 'Grupo suspenso', 'grupo.reativado': 'Grupo reativado', 'auth.login': 'Login de usuário', 'auth.logout': 'Logout de usuário',
  'empresa.criada': 'Empresa criada', 'empresa.editada': 'Empresa editada', 'usuario.criado': 'Usuário criado', 'usuario.inativado': 'Usuário inativado', 'usuario.reativado': 'Usuário reativado',
  'usuario.convite_aceito': 'Convite aceito', 'usuario.acesso_redefinido': 'Acesso redefinido', 'tema.salvo': 'Tema alterado',
  'assinatura.contratada': 'Assinatura contratada', 'assinatura.editada': 'Contrato alterado', 'assinatura.cancelada': 'Assinatura cancelada', 'assinatura.cobranca_gerada': 'Mensalidade gerada', 'assinatura.cobranca_paga': 'Mensalidade paga', 'assinatura.cobranca_cancelada': 'Mensalidade dispensada', 'assinatura.inadimplente': 'Assinatura inadimplente', 'assinatura.regularizada': 'Assinatura regularizada',
  'suporte.acesso_iniciado': 'Suporte pediu acesso', 'suporte.sessao_aberta': 'Suporte entrou', 'suporte.acesso_encerrado': 'Suporte saiu',
};

export function GrupoPagina() {
  const { id = '' } = useParams();
  const { data: eu } = useInterno();
  const qc = useQueryClient();
  const { avisar } = useToast();
  const d = useQuery({ queryKey: ['grupo', id], queryFn: () => api.get<GrupoDetalhe>(`/backoffice/grupos/${id}`) });
  const log = useQuery({ queryKey: ['grupo-log', id], queryFn: () => api.get<EventoGrupo[]>(`/backoffice/grupos/${id}/auditoria`), enabled: !!eu?.permissoes.includes('grupo.log') });
  const [acao, setAcao] = useState<Acao | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ titulo: string; texto: string; link?: string; abrir?: boolean } | null>(null);
  const pode = (p: NonNullable<typeof eu>['permissoes'][number]) => !!eu?.permissoes.includes(p);
  const g = d.data;
  const loja = (eid: string) => g?.empresas.find((e) => e.id === eid)?.nomeFantasia ?? 'Loja';

  const fechar = () => { setAcao(null); setMotivo(''); setErro(null); };
  const executar = useMutation({
    mutationFn: async (a: Acao) => {
      if (a.tipo === 'status') return api.patch(`/backoffice/grupos/${id}/status`, { status: g!.status === 'ATIVO' ? 'SUSPENSO' : 'ATIVO', motivo });
      if (a.tipo === 'entrar') return api.post<{ url: string }>(`/backoffice/grupos/${id}/entrar-como`, { motivo });
      return api.post<{ conviteLink?: string }>(`/backoffice/grupos/${id}/usuarios/${a.id}/redefinir-acesso`);
    },
    onSuccess: (r, a) => {
      qc.invalidateQueries({ queryKey: ['grupo', id] }); qc.invalidateQueries({ queryKey: ['grupo-log', id] }); qc.invalidateQueries({ queryKey: ['grupos'] });
      fechar();
      if (a.tipo === 'status') avisar(g!.status === 'ATIVO' ? 'Grupo suspenso. Os usuários perderam o acesso.' : 'Grupo reativado.');
      if (a.tipo === 'entrar') setResultado({ titulo: 'Acesso de suporte pronto', texto: 'O link abre o sistema do cliente como o Administrativo do grupo, por 30 minutos. Cada ação fica registrada no log do cliente com o seu nome. O link só funciona uma vez.', link: (r as { url: string }).url, abrir: true });
      if (a.tipo === 'redefinir') setResultado({ titulo: 'Acesso redefinido', texto: `${a.nome} foi desconectado(a) e precisa criar uma senha nova. Envie o link abaixo (vale 7 dias, uso único).`, link: (r as { conviteLink?: string }).conviteLink });
    },
    onError: (e: Error) => setErro(e.message),
  });

  if (d.isLoading) return <Carregando />;
  if (!g) return <Aviso tipo="erro">Não foi possível abrir este grupo. <Link to="/">Voltar à lista</Link></Aviso>;
  const exigeMotivo = acao?.tipo === 'status' || acao?.tipo === 'entrar';

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><p className="peq"><Link to="/">← Grupos</Link></p><h1>{g.nome}</h1><p className="mut">Criado em {formatarDataHora(g.criadoEm)}</p></div>
        <div className="linha" style={{ alignItems: 'center' }}>
          {PILULA_GRUPO[g.status]}
          {pode('suporte.entrar_como') && <Botao variante="sec" disabled={g.status !== 'ATIVO'} onClick={() => setAcao({ tipo: 'entrar' })}>Entrar como o cliente</Botao>}
          {pode('grupo.suspender') && <Botao variante={g.status === 'ATIVO' ? 'perigo' : 'primario'} onClick={() => setAcao({ tipo: 'status' })}>{g.status === 'ATIVO' ? 'Suspender grupo' : 'Reativar grupo'}</Botao>}
        </div>
      </div>

      <div className="cartao pilha"><h2>Empresas</h2><div className="tw"><table>
        <thead><tr><th>Empresa</th><th>CNPJ</th><th>Cidade</th><th>Situação</th></tr></thead>
        <tbody>{g.empresas.map((e) => <tr key={e.id}><td><b>{e.nomeFantasia}</b></td><td>{formatarCnpj(e.cnpj)}</td><td>{e.cidade}/{e.uf}</td><td>{e.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td></tr>)}</tbody>
      </table></div></div>

      {pode('assinatura.ver') && <AssinaturaGrupo grupoId={id} />}

      <div className="cartao pilha"><h2>Usuários</h2><div className="tw"><table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último login</th><th /></tr></thead>
        <tbody>{g.usuarios.map((u) => (
          <tr key={u.id}>
            <td><b>{u.nome}</b></td><td>{u.email}</td>
            <td>{u.acessoRede ? <Pilula tipo="info">Administrativo</Pilula> : u.lotacoes.map((l, i) => <div key={i}><Pilula>{ROTULO_PERFIL[l.perfil as Perfil]}</Pilula> <span className="peq mut">{loja(l.empresaId)}</span></div>)}</td>
            <td>{u.status === 'INATIVO' ? <Pilula tipo="erro">! Inativo</Pilula> : u.convitePendente ? <Pilula tipo="aviso">◔ Convite pendente</Pilula> : <Pilula tipo="ok">✓ Ativo</Pilula>}</td>
            <td>{formatarDataHora(u.ultimoLogin)}</td>
            <td>{pode('usuario.redefinir_acesso') && <Botao variante="sec" pequeno onClick={() => setAcao({ tipo: 'redefinir', id: u.id, nome: u.nome })}>Redefinir acesso</Botao>}</td>
          </tr>))}</tbody>
      </table></div></div>

      <div className="cartao pilha"><h2>Acessos de suporte</h2>
        {g.acessosSuporte.length === 0 ? <p className="mut">Nenhum acesso de suporte a este grupo.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>Motivo</th><th>Situação</th></tr></thead>
            <tbody>{g.acessosSuporte.map((a) => <tr key={a.id}><td>{formatarDataHora(a.inicio)}</td><td>{a.usuarioInterno}</td><td>{a.motivo}</td><td>{a.encerradaEm ? <Pilula>Encerrado</Pilula> : new Date(a.expiraEm) > new Date() ? <Pilula tipo="info">◔ Em andamento</Pilula> : <Pilula>Expirado</Pilula>}</td></tr>)}</tbody>
          </table></div>)}
      </div>

      {pode('grupo.log') && (
        <div className="cartao pilha"><h2>Log do grupo</h2><p className="mut peq">Os últimos 100 registros. O cliente vê este mesmo histórico na tela de Auditoria dele.</p>
          {log.isLoading ? <Carregando /> : <div className="tw"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Motivo</th></tr></thead>
            <tbody>{log.data?.map((e) => <tr key={e.id}><td>{formatarDataHora(e.criadoEm)}</td><td>{e.autor ?? 'Sistema'}</td><td><b>{ACOES[e.acao] ?? e.acao}</b></td><td>{e.motivo ?? '—'}</td></tr>)}</tbody>
          </table></div>}
        </div>
      )}

      <Dialogo aberto={!!acao} onFechar={fechar} titulo={acao?.tipo === 'entrar' ? 'Entrar como o cliente' : acao?.tipo === 'redefinir' ? `Redefinir acesso de ${acao.nome}` : g.status === 'ATIVO' ? 'Suspender grupo' : 'Reativar grupo'}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {acao?.tipo === 'status' && g.status === 'ATIVO' && <Aviso tipo="aviso">Todos os usuários do grupo perdem o acesso agora, inclusive quem está com o sistema aberto. Os dados continuam guardados.</Aviso>}
        {acao?.tipo === 'entrar' && <Aviso tipo="aviso">O acesso dura 30 minutos, mostra um aviso na tela do cliente e fica registrado no log dele com o seu nome e o motivo.</Aviso>}
        {acao?.tipo === 'redefinir' && <Aviso tipo="aviso">A pessoa perde a senha e é desconectada. Ela receberá um link para criar uma senha nova.</Aviso>}
        {exigeMotivo && <AreaTexto rotulo="Motivo" obrigatorio dica="Mínimo de 10 caracteres. Fica registrado no log do cliente." value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        <Botao variante={acao?.tipo === 'status' && g.status === 'ATIVO' ? 'perigo' : 'primario'} carregando={executar.isPending} disabled={exigeMotivo && motivo.trim().length < 10} onClick={() => { setErro(null); executar.mutate(acao!); }}>Confirmar</Botao>
      </Dialogo>

      <Dialogo aberto={!!resultado} onFechar={() => setResultado(null)} titulo={resultado?.titulo ?? ''}>
        <Aviso tipo="ok">{resultado?.texto}</Aviso>
        {resultado?.link && <Campo rotulo="Link" readOnly value={resultado.link} onFocus={(e) => e.currentTarget.select()} />}
        {resultado?.link && resultado.abrir && <a className="btn" href={resultado.link} target="_blank" rel="noopener noreferrer">Abrir o sistema do cliente</a>}
      </Dialogo>
    </div>
  );
}
