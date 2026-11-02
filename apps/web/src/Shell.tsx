import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROTULO_PERFIL, formatarBRL, type Perfil, type Permissao } from '@ecv/shared';
import { Aviso, Botao, Icone, aplicarTema, useToast, type NomeIcone } from '@ecv/ui';
import { api } from './api';
import { useSessao } from './sessao';
import type { AvisoAssinatura, Empresa, Eu, TemaEfetivo } from './tipos';
import { dataBr } from './formulario';
import redbox from './redbox.png';
import domma from './domma.png';

const MENU: { para: string; rotulo: string; icone: NomeIcone; perm?: Permissao; fim?: boolean; naoPara?: Perfil[] }[] = [
  { para: '/', rotulo: 'Início', icone: 'painel', fim: true },
  { para: '/lancar', rotulo: 'Lançar laudo', icone: 'laudo', perm: 'laudo.lancar' },
  { para: '/laudos', rotulo: 'Laudos', icone: 'laudo', perm: 'laudo.ver' },
  { para: '/laudos', rotulo: 'Meus laudos', icone: 'laudo', perm: 'laudo.ver_proprios', naoPara: ['ADMINISTRATIVO', 'GERENTE', 'FINANCEIRO'] },
  { para: '/receber', rotulo: 'A receber', icone: 'caixa', perm: 'receber.ver' },
  { para: '/pagar', rotulo: 'A pagar', icone: 'caixa', perm: 'pagar.ver' },
  { para: '/cartoes', rotulo: 'Cartões e cheques', icone: 'caixa', perm: 'cheque.controlar' },
  { para: '/comissoes', rotulo: 'Comissões', icone: 'usuarios', perm: 'comissao.ver' },
  { para: '/royalties', rotulo: 'Royalties', icone: 'empresas', perm: 'repasse.ver' },
  { para: '/faturados', rotulo: 'Faturados', icone: 'laudo', perm: 'receber.ver' },
  { para: '/caixa', rotulo: 'Caixa', icone: 'caixa', perm: 'caixa.ver' },
  { para: '/relatorios', rotulo: 'Relatórios', icone: 'auditoria', perm: 'relatorio.operacional' },
  { para: '/clientes', rotulo: 'Clientes e preços', icone: 'usuarios', perm: 'cliente.ver', naoPara: ['VISTORIADOR'] },
  { para: '/fornecedores', rotulo: 'Fornecedores', icone: 'empresas', perm: 'fornecedor.ver' },
  { para: '/cadastros', rotulo: 'Cadastros', icone: 'grupos', perm: 'servico.ver', naoPara: ['VISTORIADOR'] },
  { para: '/empresas', rotulo: 'Empresas', icone: 'empresas' },
  { para: '/usuarios', rotulo: 'Usuários', icone: 'usuarios', perm: 'usuario.gerir' },
  { para: '/aparencia', rotulo: 'Aparência', icone: 'aparencia', perm: 'tema.editar' },
  { para: '/assinatura', rotulo: 'Assinatura', icone: 'caixa', perm: 'assinatura.ver' },
  { para: '/auditoria', rotulo: 'Auditoria', icone: 'auditoria', perm: 'auditoria.ver' },
];

export function Shell({ eu }: { eu: Eu }) {
  const { sair } = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { avisar } = useToast();

  const empresas = useQuery({ queryKey: ['empresas'], queryFn: () => api.get<Empresa[]>('/empresas') });
  const tema = useQuery({ queryKey: ['tema', eu.empresaAtivaId], queryFn: () => api.get<TemaEfetivo | Record<string, never>>('/tema') });
  useEffect(() => {
    const t = tema.data as TemaEfetivo | undefined;
    aplicarTema(t && 'derivado' in t ? t.derivado : null);
  }, [tema.data]);

  const trocar = async (empresaId: string) => {
    try {
      const novo = await api.post<Eu>('/auth/empresa-ativa', { empresaId });
      qc.setQueryData(['eu'], novo);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'eu' && q.queryKey[0] !== 'empresas' });
    } catch (e) { avisar((e as Error).message, 'erro'); }
  };
  const aviso = useQuery({ queryKey: ['assinatura-aviso'], queryFn: () => api.get<AvisoAssinatura>('/assinatura/aviso'), enabled: eu.permissoes.includes('assinatura.ver'), staleTime: 5 * 60_000 });
  const ativa = empresas.data?.find((e) => e.id === eu.empresaAtivaId);
  const itens = MENU.filter((m) => (!m.perm || eu.permissoes.includes(m.perm)) && !(eu.perfilAtivo && m.naoPara?.includes(eu.perfilAtivo)));
  const iniciais = eu.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      {eu.suporte && (
        <div className="faixa-suporte" role="status">
          <span>Acesso de suporte por <b>{eu.suporte.usuarioInterno}</b> · motivo: {eu.suporte.motivo} · termina às {new Date(eu.suporte.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <button className="btn" onClick={async () => { await sair(); nav('/login'); }}>Encerrar acesso</button>
        </div>
      )}
      <div className="shell">
        <aside className="lateral-nav">
          <div className="marca"><i>EC</i><span>ECV Cash<small>{ativa?.nomeFantasia ?? ' '}</small></span></div>
          <nav className="nav" aria-label="Menu principal">
            {itens.map((m) => (
              <NavLink key={m.para} to={m.para} end={m.fim}><Icone nome={m.icone} />{m.rotulo}</NavLink>
            ))}
          </nav>
          <div className="rodape-nav">
            <span className="peq mut">Sistema desenvolvido por</span>
            <img src={domma} alt="Domma Tecnologia" style={{ width: 104 }} />
            <span className="peq mut">Design por</span>
            <img src={redbox} alt="REDBOX" />
          </div>
        </aside>
        <div className="principal">
          <header className="topo">
            <div>
              <label htmlFor="empresa-ativa">Empresa ativa</label>
              <select id="empresa-ativa" value={eu.empresaAtivaId ?? ''} onChange={(e) => trocar(e.target.value)} disabled={(empresas.data?.length ?? 0) < 2}>
                {empresas.data?.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia}</option>)}
              </select>
            </div>
            <div className="usuario">
              <div className="avatar" aria-hidden="true">{iniciais}</div>
              <div><b>{eu.nome}</b><span className="mut peq">{eu.perfilAtivo ? ROTULO_PERFIL[eu.perfilAtivo] : ''}</span></div>
              <Botao variante="sec" pequeno onClick={async () => { await sair(); nav('/login'); }}>Sair</Botao>
            </div>
          </header>
          {aviso.data && aviso.data.tipo !== 'nenhum' && (
            <div style={{ padding: '12px 24px 0' }}>
              <Aviso tipo={aviso.data.tipo === 'atraso' ? 'erro' : 'aviso'}>
                {aviso.data.tipo === 'atraso'
                  ? `Há ${aviso.data.quantidade} mensalidade(s) da assinatura vencida(s) desde ${dataBr(aviso.data.vencimento)}.`
                  : `A mensalidade da assinatura (${formatarBRL(aviso.data.valorCentavos)}) vence em ${dataBr(aviso.data.vencimento)}.`}{' '}
                <NavLink to="/assinatura">Ver assinatura</NavLink>
              </Aviso>
            </div>
          )}
          <main className="conteudo"><Outlet context={{ eu, empresas: empresas.data ?? [] }} /></main>
        </div>
      </div>
    </>
  );
}
