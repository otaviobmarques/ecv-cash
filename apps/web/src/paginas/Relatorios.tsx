import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Selecao } from '@ecv/ui';
import { API_BASE, api } from '../api';
import { dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { Eu, RelatorioDef, RelatorioResposta } from '../tipos';

const ROTULO_AGRUPAR: Record<string, string> = { dia: 'Dia', cliente: 'Cliente', servico: 'Serviço', vistoriador: 'Vistoriador', forma: 'Forma de pagamento', conta: 'Conta', fornecedor: 'Favorecido', plano: 'Conta do plano' };
const celula = (v: unknown, tipo: string) => (v === null || v === undefined ? '' : tipo === 'dinheiro' ? formatarBRL(Number(v)) : tipo === 'data' ? dataBr(String(v)) : String(v));

export function Relatorios() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const cat = useQuery({ queryKey: ['relatorios', 'catalogo', eu.empresaAtivaId], enabled: !!eu.empresaAtivaId, queryFn: () => api.get<RelatorioDef[]>('/relatorios') });
  const [id, setId] = useState(''); const [agrupar, setAgrupar] = useState('');
  const [de, setDe] = useState(hojeIso().slice(0, 8) + '01'); const [ate, setAte] = useState(hojeIso());
  const def = cat.data?.find((r) => r.id === (id || cat.data?.[0]?.id));
  const ag = def?.agrupar.includes(agrupar) ? agrupar : def?.agrupar[0] ?? '';
  const qs = new URLSearchParams({ de, ate }); if (ag) qs.set('agrupar', ag);
  const r = useQuery({ queryKey: ['relatorios', def?.id, qs.toString(), eu.empresaAtivaId], enabled: !!def, queryFn: () => api.get<RelatorioResposta>(`/relatorios/${def!.id}?${qs}`) });
  if (!eu.empresaAtivaId) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Relatórios</h1><p className="mut">Da loja ativa. Exportar gera uma planilha que o Excel abre direto, e a exportação fica registrada na auditoria.</p></div></div>
      {cat.isLoading ? <Carregando /> : !cat.data?.length ? <Aviso tipo="info">Seu perfil não tem relatórios.</Aviso> : (
        <>
          <div className="cartao">
            <div className="linha">
              <Selecao rotulo="Relatório" value={def?.id ?? ''} onChange={(e) => { setId(e.target.value); setAgrupar(''); }}>{cat.data.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}</Selecao>
              {def && def.agrupar.length > 0 && <Selecao rotulo="Agrupar por" value={ag} onChange={(e) => setAgrupar(e.target.value)}>{def.agrupar.map((k) => <option key={k} value={k}>{ROTULO_AGRUPAR[k]}</option>)}</Selecao>}
              {def?.id !== 'inadimplencia' && <><Campo rotulo="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} /><Campo rotulo="Até" type="date" max={hojeIso()} value={ate} onChange={(e) => setAte(e.target.value)} /></>}
              {eu.permissoes.includes('exportar') && def && <a className="btn sec" href={`${API_BASE}/relatorios/${def.id}?${qs}&formato=csv`} target="_blank" rel="noreferrer">Exportar planilha (CSV)</a>}
            </div>
          </div>
          <div className="cartao pilha">
            {r.isLoading ? <Carregando /> : r.isError ? <Aviso tipo="erro">{mensagemDoErro(r.error)}</Aviso> : r.data && (
              <>
                <h2>{r.data.titulo}</h2>
                <div className="tw"><table>
                  <thead><tr>{r.data.colunas.map((c) => <th key={c.chave} className={c.tipo === 'texto' || c.tipo === 'data' ? '' : 'num'}>{c.rotulo}</th>)}</tr></thead>
                  <tbody>
                    {r.data.linhas.map((l, i) => <tr key={i}>{r.data!.colunas.map((c) => <td key={c.chave} className={c.tipo === 'texto' || c.tipo === 'data' ? '' : 'num'}>{celula(l[c.chave], c.tipo)}</td>)}</tr>)}
                    {r.data.linhas.length === 0 && <tr><td colSpan={r.data.colunas.length} className="vazio">Nada neste período.</td></tr>}
                    {r.data.totais && r.data.linhas.length > 0 && <tr style={{ fontWeight: 700, background: 'var(--suave)' }}>{r.data.colunas.map((c, i) => <td key={c.chave} className={c.tipo === 'texto' || c.tipo === 'data' ? '' : 'num'}>{i === 0 ? 'Total' : celula(r.data!.totais![c.chave], c.tipo)}</td>)}</tr>}
                  </tbody>
                </table></div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
