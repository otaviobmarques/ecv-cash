import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Aviso, Botao, Campo, Carregando, Dialogo, Selecao, useToast } from '@ecv/ui';
import { API_BASE, api } from '../api';
import { CampoDinheiro, dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { Eu, PlanoConta, RelatorioDef, RelatorioResposta } from '../tipos';

const ROTULO_AGRUPAR: Record<string, string> = { dia: 'Dia', cliente: 'Cliente', servico: 'Serviço', vistoriador: 'Vistoriador', forma: 'Forma de pagamento', conta: 'Conta', fornecedor: 'Favorecido', plano: 'Conta do plano', competencia: 'Por competência (quando o laudo foi feito)', caixa: 'Por caixa (quando o dinheiro entrou e saiu)', realizado: 'Realizado (já aconteceu)', projetado: 'Projetado (o que está previsto)' };
const celula = (v: unknown, tipo: string) => (v === null || v === undefined ? '' : tipo === 'dinheiro' ? formatarBRL(Number(v)) : tipo === 'data' ? dataBr(String(v)) : String(v));
const estiloLinha = (l: Record<string, unknown>) => ({ fontWeight: l._negrito ? 700 : undefined, background: l._negrito ? 'var(--suave)' : undefined, color: l._alerta ? 'var(--erro)' : undefined });

export function Relatorios() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const cat = useQuery({ queryKey: ['relatorios', 'catalogo', eu.empresaAtivaId], enabled: !!eu.empresaAtivaId, queryFn: () => api.get<RelatorioDef[]>('/relatorios') });
  const [id, setId] = useState(''); const [agrupar, setAgrupar] = useState('');
  const [de, setDe] = useState(hojeIso().slice(0, 8) + '01'); const [ate, setAte] = useState(hojeIso()); const [dias, setDias] = useState('60'); const [rede, setRede] = useState(false); const [eliminar, setEliminar] = useState(true);
  const def = cat.data?.find((r) => r.id === (id || cat.data?.[0]?.id));
  const ag = def?.agrupar.includes(agrupar) ? agrupar : def?.agrupar[0] ?? '';
  const qs = new URLSearchParams({ de, ate }); if (ag) qs.set('agrupar', ag); if (def?.id === 'fluxo-caixa' && ag === 'projetado') qs.set('dias', dias);
  const podeRede = eu.rede && (def?.id === 'dre' || def?.id === 'fluxo-caixa' || def?.id === 'balanco');
  const [saldos, setSaldos] = useState(false);
  if (podeRede && rede) { qs.set('escopo', 'rede'); if (!eliminar) qs.set('eliminar', '0'); }
  const semDatas = def?.id === 'inadimplencia' || (def?.id === 'fluxo-caixa' && ag === 'projetado');
  const r = useQuery({ queryKey: ['relatorios', def?.id, qs.toString(), eu.empresaAtivaId], enabled: !!def, queryFn: () => api.get<RelatorioResposta>(`/relatorios/${def!.id}?${qs}`) });
  if (!eu.empresaAtivaId) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Relatórios</h1><p className="mut">Da loja ativa. Exportar gera uma planilha que o Excel abre direto, e a exportação fica registrada na auditoria.</p></div></div>
      <SaldosManuais aberto={saldos} onFechar={() => setSaldos(false)} />
      {cat.isLoading ? <Carregando /> : !cat.data?.length ? <Aviso tipo="info">Seu perfil não tem relatórios.</Aviso> : (
        <>
          <div className="cartao">
            <div className="linha">
              <Selecao rotulo="Relatório" value={def?.id ?? ''} onChange={(e) => { setId(e.target.value); setAgrupar(''); }}>{cat.data.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}</Selecao>
              {def && def.agrupar.length > 0 && <Selecao rotulo="Agrupar por" value={ag} onChange={(e) => setAgrupar(e.target.value)}>{def.agrupar.map((k) => <option key={k} value={k}>{ROTULO_AGRUPAR[k]}</option>)}</Selecao>}
              {def?.id === 'fluxo-caixa' && ag === 'projetado' && <Selecao rotulo="Olhar para frente" value={dias} onChange={(e) => setDias(e.target.value)}>{['30', '60', '90', '180'].map((d) => <option key={d} value={d}>{d} dias</option>)}</Selecao>}
              {!semDatas && def?.id !== 'balanco' && <><Campo rotulo="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} /><Campo rotulo="Até" type="date" max={hojeIso()} value={ate} onChange={(e) => setAte(e.target.value)} /></>}
              {def?.id === 'balanco' && <Campo rotulo="Posição em" type="date" max={hojeIso()} value={ate} onChange={(e) => setAte(e.target.value)} />}
              {def?.id === 'balanco' && eu.permissoes.includes('balanco.editar') && <Botao variante="sec" onClick={() => setSaldos(true)}>Informar saldos (imobilizado, empréstimos...)</Botao>}
              {podeRede && <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={rede} onChange={(e) => setRede(e.target.checked)} />Consolidado da rede (todas as lojas)</label>}
              {podeRede && rede && <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={eliminar} onChange={(e) => setEliminar(e.target.checked)} />Tirar o movimento entre empresas do grupo</label>}
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
                    {r.data.linhas.map((l, i) => <tr key={i} style={estiloLinha(l)}>{r.data!.colunas.map((c, ci) => <td key={c.chave} className={c.tipo === 'texto' || c.tipo === 'data' ? '' : 'num'} style={ci === 0 && l._sub ? { paddingLeft: 28, color: 'var(--texto-2)' } : undefined}>{celula(l[c.chave], c.tipo)}</td>)}</tr>)}
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

function SaldosManuais({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['balanco', 'saldos'], enabled: aberto, queryFn: () => api.get<{ automaticas: string[]; saldos: { id: string; codigo: string; nome: string; tipo: string; dataBase: string; valorCentavos: number; observacao: string | null }[] }>('/balanco/saldos') });
  const plano = useQuery({ queryKey: ['plano-contas'], enabled: aberto, queryFn: () => api.get<PlanoConta[]>('/plano-contas') });
  const [f, setF] = useState({ conta: '', data: hojeIso(), valor: null as number | null, obs: '' });
  const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.put('/balanco/saldos', { planoContaId: f.conta, dataBase: f.data, valorCentavos: f.valor ?? 0, observacao: f.obs || undefined }),
    onSuccess: () => { avisar('Saldo informado.'); setErro(null); setF({ ...f, valor: null, obs: '' }); qc.invalidateQueries({ queryKey: ['balanco'] }); qc.invalidateQueries({ queryKey: ['relatorios'] }); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const contas = plano.data?.filter((c) => c.aceitaLancamento && c.status === 'ATIVO' && ['ATIVO', 'PASSIVO', 'PATRIMONIO'].includes(c.tipo) && !lista.data?.automaticas.includes(c.codigo)) ?? [];
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Saldos informados para o balanço" lateral>
      <div className="pilha">
        <p className="mut">Caixa, contas a receber e contas a pagar o sistema calcula sozinho. Aqui você informa o que ele não sabe: imobilizado, empréstimos, capital. O valor vale da data-base em diante, até você informar outro.</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao rotulo="Conta" obrigatorio value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })}><option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome} ({c.tipo === 'ATIVO' ? 'ativo' : c.tipo === 'PASSIVO' ? 'passivo' : 'patrimônio'})</option>)}</Selecao>
        <div className="linha"><Campo rotulo="Data-base" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /><CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} /></div>
        <Campo rotulo="Observação" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} dica="Ex.: reavaliação, parcela do financiamento." />
        <Botao carregando={m.isPending} disabled={!f.conta} onClick={() => m.mutate()}>Salvar saldo</Botao>
        <h3>Informados até agora</h3>
        {lista.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Conta</th><th>Data-base</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {lista.data?.saldos.map((x) => <tr key={x.id}><td>{x.codigo} {x.nome}{x.observacao && <div className="peq mut">{x.observacao}</div>}</td><td>{dataBr(x.dataBase)}</td><td className="num">{formatarBRL(x.valorCentavos)}</td></tr>)}
              {lista.data?.saldos.length === 0 && <tr><td colSpan={3} className="vazio">Nenhum saldo informado ainda.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
    </Dialogo>
  );
}
