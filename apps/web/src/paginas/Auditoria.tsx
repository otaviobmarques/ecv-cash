import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Botao, Carregando, Selecao, formatarDataHora } from '@ecv/ui';
import { api } from '../api';
import type { Empresa, EventoAuditoria, Eu } from '../tipos';

const ACOES: Record<string, string> = {
  'auth.login': 'Entrou no sistema', 'auth.logout': 'Saiu do sistema',
  'empresa.criada': 'Empresa criada', 'empresa.editada': 'Empresa editada',
  'usuario.criado': 'Usuário criado', 'usuario.inativado': 'Usuário inativado', 'usuario.reativado': 'Usuário reativado',
  'usuario.convite_aceito': 'Convite aceito', 'usuario.acesso_redefinido': 'Acesso redefinido pelo suporte',
  'tema.salvo': 'Cor do tema alterada', 'grupo.criado': 'Grupo criado', 'grupo.suspenso': 'Grupo suspenso', 'grupo.reativado': 'Grupo reativado',
  'suporte.acesso_iniciado': 'Suporte pediu acesso', 'suporte.sessao_aberta': 'Suporte entrou no sistema', 'suporte.acesso_encerrado': 'Suporte encerrou o acesso',
};
const CAMPOS: Record<string, string> = { nomeFantasia: 'Nome fantasia', cidade: 'Cidade', uf: 'UF', emailFinanceiro: 'E-mail do financeiro', corPrimaria: 'Cor principal', status: 'Situação', nome: 'Nome', email: 'E-mail', perfil: 'Perfil' };

function Mudancas({ e }: { e: EventoAuditoria }) {
  const chaves = Array.from(new Set([...Object.keys(e.antes ?? {}), ...Object.keys(e.depois ?? {})])).filter((k) => CAMPOS[k] && JSON.stringify(e.antes?.[k]) !== JSON.stringify(e.depois?.[k]));
  if (!chaves.length && !e.motivo) return <span className="mut">—</span>;
  return (
    <div className="peq">
      {chaves.map((k) => <div key={k}>{CAMPOS[k]}: {e.antes && k in e.antes ? <s>{String(e.antes[k] ?? '—')}</s> : null}{e.antes && k in e.antes ? ' → ' : ''}<b>{String(e.depois?.[k] ?? '—')}</b></div>)}
      {e.motivo && <div className="mut">Motivo: {e.motivo}</div>}
    </div>
  );
}

export function Auditoria() {
  const { empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const [entidade, setEntidade] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['auditoria', entidade],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.get<{ itens: EventoAuditoria[]; proximoAntesDoId: number | null }>(`/auditoria?limite=30${entidade ? `&entidade=${entidade}` : ''}${pageParam ? `&antesDoId=${pageParam}` : ''}`),
    getNextPageParam: (p) => p.proximoAntesDoId ?? undefined,
  });
  const itens = q.data?.pages.flatMap((p) => p.itens) ?? [];
  const loja = (id: string | null) => empresas.find((e) => e.id === id)?.nomeFantasia ?? '—';

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Auditoria</h1><p className="mut">Quem fez o quê e quando. Os registros não podem ser alterados nem apagados.</p></div>
        <div style={{ minWidth: 220 }}>
          <Selecao rotulo="Tipo" value={entidade} onChange={(e) => setEntidade(e.target.value)}>
            <option value="">Tudo</option><option value="empresa">Empresas</option><option value="usuario">Usuários</option><option value="tema">Aparência</option><option value="sessao">Acessos</option>
          </Selecao>
        </div>
      </div>
      <div className="cartao">
        {q.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Loja</th><th>Detalhes</th></tr></thead>
            <tbody>
              {itens.map((e) => (
                <tr key={e.id}>
                  <td className="num" style={{ textAlign: 'left' }}>{formatarDataHora(e.criadoEm)}</td>
                  <td>{e.usuario ?? 'Sistema'}</td>
                  <td><b>{ACOES[e.acao] ?? e.acao}</b></td>
                  <td>{loja(e.empresaId)}</td>
                  <td><Mudancas e={e} /></td>
                </tr>
              ))}
              {itens.length === 0 && <tr><td colSpan={5} className="vazio">Nada registrado ainda.</td></tr>}
            </tbody>
          </table></div>
        )}
        {q.hasNextPage && <div style={{ marginTop: 12 }}><Botao variante="sec" carregando={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Mostrar mais</Botao></div>}
      </div>
    </div>
  );
}
