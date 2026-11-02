import { Navigate, Route, Routes } from 'react-router-dom';
import { Carregando } from '@ecv/ui';
import { useEu } from './sessao';
import { Shell } from './Shell';
import { Login } from './paginas/Login';
import { Convite } from './paginas/Convite';
import { Suporte } from './paginas/Suporte';
import { Inicio } from './paginas/Inicio';
import { Empresas } from './paginas/Empresas';
import { Usuarios } from './paginas/Usuarios';
import { Aparencia } from './paginas/Aparencia';
import { Auditoria } from './paginas/Auditoria';
import { Clientes } from './paginas/Clientes';
import { Fornecedores } from './paginas/Fornecedores';
import { LancarLaudo } from './paginas/LancarLaudo';
import { Laudos } from './paginas/Laudos';
import { Receber } from './paginas/Receber';
import { Faturados } from './paginas/Faturados';
import { Pagar } from './paginas/Pagar';
import { Relatorios } from './paginas/Relatorios';
import { Caixa } from './paginas/Caixa';
import { Cadastros } from './paginas/Cadastros';

export function App() {
  const { data: eu, isLoading, isError } = useEu();
  if (isLoading) return <Carregando />;
  if (isError) return <Falha />;
  return (
    <Routes>
      <Route path="/login" element={eu ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/convite" element={<Convite />} />
      <Route path="/suporte" element={<Suporte />} />
      <Route element={eu ? <Shell eu={eu} /> : <Navigate to="/login" replace />}>
        <Route index element={<Inicio />} />
        <Route path="lancar" element={<LancarLaudo />} />
        <Route path="laudos" element={<Laudos />} />
        <Route path="receber" element={<Receber />} />
        <Route path="faturados" element={<Faturados />} />
        <Route path="pagar" element={<Pagar />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="caixa" element={<Caixa />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="fornecedores" element={<Fornecedores />} />
        <Route path="cadastros" element={<Cadastros />} />
        <Route path="empresas" element={<Empresas />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="aparencia" element={<Aparencia />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const Falha = () => (
  <div className="centro"><div className="cartao">
    <h1>Sem conexão com o servidor</h1>
    <p className="mut">Não foi possível carregar o sistema. Confira sua internet e atualize a página.</p>
  </div></div>
);
