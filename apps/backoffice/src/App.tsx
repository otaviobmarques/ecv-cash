import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { Botao, Carregando, Pilula } from '@ecv/ui';
import { ROTULO_PAPEL_INTERNO } from '@ecv/shared';
import { useInterno, useSessaoInterna } from './sessao';
import { Login } from './paginas/Login';
import { Grupos } from './paginas/Grupos';
import { GrupoPagina } from './paginas/Grupo';
import { Planos } from './paginas/Planos';
import { Mensalidades } from './paginas/Mensalidades';
import domma from './domma.png';

function Moldura() {
  const { data: eu } = useInterno();
  const { sair } = useSessaoInterna();
  const estilo = ({ isActive }: { isActive: boolean }) => ({ fontWeight: 700, color: isActive ? 'var(--verde)' : 'var(--texto)', textDecoration: isActive ? 'underline' : 'none' } as const);
  const nav = useNavigate();
  if (!eu) return <Navigate to="/login" replace />;
  return (
    <>
      <header className="topo" style={{ borderBottom: '3px solid var(--verde)' }}>
        <div className="linha" style={{ alignItems: 'center' }}>
          <Link to="/" style={{ textDecoration: 'none' }}><b style={{ fontSize: 18, color: 'var(--verde)' }}>ECV Cash · Backoffice</b></Link>
          <Pilula tipo="info">Sistema separado</Pilula>
          <nav className="linha" aria-label="Seções" style={{ gap: 16, marginLeft: 8 }}>
            <NavLink to="/" end style={estilo}>Grupos</NavLink>
            {eu.permissoes.includes('assinatura.ver') && <NavLink to="/mensalidades" style={estilo}>Mensalidades</NavLink>}
            {eu.permissoes.includes('assinatura.ver') && <NavLink to="/planos" style={estilo}>Planos</NavLink>}
          </nav>
        </div>
        <div className="usuario">
          <div><b>{eu.nome}</b><span className="mut peq">{ROTULO_PAPEL_INTERNO[eu.papel]}</span></div>
          <Botao variante="sec" pequeno onClick={async () => { await sair(); nav('/login'); }}>Sair</Botao>
        </div>
      </header>
      <main className="conteudo"><Outlet /></main>
      <footer style={{ padding: '0 24px 24px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="peq mut">Sistema desenvolvido pela</span><img src={domma} alt="Domma Tecnologia" style={{ width: 120 }} />
      </footer>
    </>
  );
}

export function App() {
  const { isLoading, isError } = useInterno();
  if (isLoading) return <Carregando />;
  if (isError) return <div className="centro"><div className="cartao"><h1>Sem conexão com o servidor</h1><p className="mut">Não foi possível carregar o backoffice. Confira a internet e atualize a página.</p></div></div>;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Moldura />}>
        <Route index element={<Grupos />} />
        <Route path="grupos/:id" element={<GrupoPagina />} />
        <Route path="mensalidades" element={<Mensalidades />} />
        <Route path="planos" element={<Planos />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
