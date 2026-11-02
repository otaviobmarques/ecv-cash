import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { Cheque, ContaCaixa, Eu, VendaCartao } from '../tipos';

export function CartoesCheques() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const [aba, setAba] = useState<'cartoes' | 'cheques'>('cartoes');
  if (!eu.empresaAtivaId) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Cartões e cheques</h1><p className="mut">O dinheiro do cartão entra quando a operadora paga; o do cheque, quando ele compensa. Aqui você acompanha e dá entrada no caixa.</p></div></div>
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)' }}>
        {([['cartoes', 'Cartões a receber'], ['cheques', 'Cheques']] as const).map(([id, r]) => <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: aba === id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${aba === id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{r}</button>)}
      </div>
      {aba === 'cartoes' ? <Cartoes eu={eu} /> : <Cheques eu={eu} />}
    </div>
  );
}

function useContas(ativo: boolean, soBanco = false) {
  const q = useQuery({ queryKey: ['caixa', 'contas-sel'], enabled: ativo, queryFn: () => api.get<{ contas: ContaCaixa[] }>('/caixa/contas') });
  return q.data?.contas.filter((c) => c.status === 'ATIVO' && (!soBanco || c.tipo === 'BANCO')) ?? [];
}

function Cartoes({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [sit, setSit] = useState<'previstas' | 'atrasadas' | 'liquidadas' | 'canceladas' | 'todas'>('previstas');
  const lista = useQuery({ queryKey: ['cartao', eu.empresaAtivaId, sit], queryFn: () => api.get<{ itens: VendaCartao[]; total: number; brutoCentavos: number; taxasCentavos: number; liquidoCentavos: number; agenda: { data: string; liquidoCentavos: number; vendas: number }[] }>(`/cartao/liquidacoes?situacao=${sit}`) });
  const contas = useContas(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [conta, setConta] = useState(''); const [data, setData] = useState(hojeIso());
  const [erro, setErro] = useState<string | null>(null);
  const [um, setUm] = useState<VendaCartao | null>(null); const [liquidoRec, setLiquidoRec] = useState(''); const [motivo, setMotivo] = useState('');
  const [desfazer, setDesfazer] = useState<VendaCartao | null>(null);
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['cartao'] }); qc.invalidateQueries({ queryKey: ['caixa'] }); };
  const podeBaixar = eu.permissoes.includes('receber.baixar');
  const lote = useMutation({
    mutationFn: () => api.post<{ liquidadas: number; erros: number; resultados: { id: string; ok: boolean; erro?: string }[] }>('/cartao/liquidacoes/lote', { ids: [...sel], contaId: conta, data }),
    onSuccess: (r) => { avisar(r.erros ? `${r.liquidadas} liquidadas, ${r.erros} com problema.` : `${r.liquidadas} vendas liquidadas.`); setErro(r.resultados.find((x) => !x.ok)?.erro ?? null); setSel(new Set()); recarregar(); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const liquidar = useMutation({
    mutationFn: () => api.post(`/cartao/liquidacoes/${um!.id}/liquidar`, { contaId: conta, data, liquidoRecebidoCentavos: liquidoRec ? Math.round(Number(liquidoRec.replace(/\./g, '').replace(',', '.')) * 100) : undefined, motivo: motivo || undefined }),
    onSuccess: () => { avisar('Depósito registrado.'); setUm(null); setLiquidoRec(''); setMotivo(''); setErro(null); recarregar(); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const undo = useMutation({
    mutationFn: () => api.post(`/cartao/liquidacoes/${desfazer!.id}/desfazer`, { motivo }),
    onSuccess: () => { avisar('Liquidação desfeita.'); setDesfazer(null); setMotivo(''); setErro(null); recarregar(); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const previstas = (lista.data?.itens ?? []).filter((i) => i.status === 'PREVISTO');
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="pilha">
      {lista.data && lista.data.agenda.length > 0 && (
        <div className="cartao pilha"><h2>A operadora vai pagar</h2>
          <div className="linha">{lista.data.agenda.slice(0, 8).map((a) => <div key={a.data} className="cartao" style={{ padding: 12, background: 'var(--suave)' }}><span className="peq mut">{dataBr(a.data)}</span><br /><b className="num" style={{ textAlign: 'left' }}>{formatarBRL(a.liquidoCentavos)}</b><br /><span className="peq mut">{a.vendas} vendas</span></div>)}</div>
        </div>
      )}
      <div className="cartao pilha">
        <div className="linha">
          <Selecao rotulo="Situação" value={sit} onChange={(e) => setSit(e.target.value as typeof sit)}><option value="previstas">Previstas</option><option value="atrasadas">Atrasadas</option><option value="liquidadas">Liquidadas</option><option value="canceladas">Canceladas</option><option value="todas">Todas</option></Selecao>
          {podeBaixar && sit !== 'liquidadas' && sit !== 'canceladas' && (<>
            <Selecao rotulo="Conta do depósito" value={conta} onChange={(e) => setConta(e.target.value)}><option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
            <Campo rotulo="Data do depósito" type="date" max={hojeIso()} value={data} onChange={(e) => setData(e.target.value)} />
            <Botao disabled={!sel.size || !conta} carregando={lote.isPending} onClick={() => lote.mutate()}>Liquidar {sel.size || ''} selecionadas</Botao>
          </>)}
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {lista.isLoading ? <Carregando /> : (
          <>
            <span className="mut">{lista.data?.total} vendas · bruto {formatarBRL(lista.data?.brutoCentavos ?? 0)} · taxas {formatarBRL(lista.data?.taxasCentavos ?? 0)} · líquido {formatarBRL(lista.data?.liquidoCentavos ?? 0)}</span>
            <div className="tw"><table>
              <thead><tr>{podeBaixar && <th><span className="sr">Selecionar</span></th>}<th>Laudo</th><th>Cliente</th><th>Forma</th><th>Venda</th><th>Previsto</th><th className="num">Bruto</th><th className="num">Taxa</th><th className="num">Líquido</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {lista.data?.itens.map((v) => (
                  <tr key={v.id}>
                    {podeBaixar && <td>{v.status === 'PREVISTO' && <input type="checkbox" aria-label={`Selecionar laudo ${v.numero}`} checked={sel.has(v.id)} onChange={() => alternar(v.id)} />}</td>}
                    <td>{v.numero}<div className="peq mut">{v.placa}</div></td><td>{v.cliente}</td><td>{v.forma}</td><td>{dataBr(v.dataVenda)}</td><td>{dataBr(v.dataPrevista)}{v.atrasada && <div className="peq" style={{ color: 'var(--erro)' }}>atrasada</div>}</td>
                    <td className="num">{formatarBRL(v.brutoCentavos)}</td><td className="num">{formatarBRL(v.taxaCentavos + v.antecipacaoCentavos)}</td><td className="num">{formatarBRL(v.liquidoCentavos)}</td>
                    <td>{v.status === 'LIQUIDADO' ? <Pilula tipo="ok">✓ Liquidada</Pilula> : v.status === 'CANCELADO' ? <Pilula>Cancelada</Pilula> : v.atrasada ? <Pilula tipo="erro">! Atrasada</Pilula> : <Pilula tipo="neutra">Prevista</Pilula>}{v.conta && <div className="peq mut">{v.conta} · {dataBr(v.dataLiquidacao)}</div>}</td>
                    <td>{v.status === 'PREVISTO' && podeBaixar && <Botao variante="sec" pequeno onClick={() => { setUm(v); setErro(null); setMotivo(''); setLiquidoRec(''); }}>Liquidar</Botao>}{v.status === 'LIQUIDADO' && eu.permissoes.includes('receber.estornar') && <Botao variante="sec" pequeno onClick={() => { setDesfazer(v); setErro(null); setMotivo(''); }}>Desfazer</Botao>}</td>
                  </tr>
                ))}
                {lista.data?.itens.length === 0 && <tr><td colSpan={11} className="vazio">Nenhuma venda no cartão neste filtro.</td></tr>}
              </tbody>
            </table></div>
          </>
        )}
      </div>
      <Dialogo aberto={!!um} onFechar={() => setUm(null)} titulo={um ? `Liquidar laudo nº ${um.numero}` : 'Liquidar'}>
        {um && <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <p>Previsto: <b>{formatarBRL(um.liquidoCentavos)}</b> (bruto {formatarBRL(um.brutoCentavos)}, taxa {formatarBRL(um.taxaCentavos + um.antecipacaoCentavos)}).</p>
          <Selecao rotulo="Conta do depósito" obrigatorio value={conta} onChange={(e) => setConta(e.target.value)}><option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
          <Campo rotulo="Data do depósito" type="date" max={hojeIso()} value={data} onChange={(e) => setData(e.target.value)} />
          <Campo rotulo="Valor depositado, se diferente (R$)" inputMode="decimal" value={liquidoRec} onChange={(e) => setLiquidoRec(e.target.value)} dica="A diferença para menos vira taxa." />
          {liquidoRec && <Campo rotulo="Motivo da diferença" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          <Botao carregando={liquidar.isPending} onClick={() => liquidar.mutate()}>Registrar depósito</Botao>
        </div>}
      </Dialogo>
      <Dialogo aberto={!!desfazer} onFechar={() => setDesfazer(null)} titulo="Desfazer liquidação">
        <div className="pilha">{erro && <Aviso tipo="erro">{erro}</Aviso>}
          <p className="mut">O dinheiro sai da conta de novo e a venda volta a ser prevista.</p>
          <Campo rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <Botao variante="perigo" carregando={undo.isPending} onClick={() => undo.mutate()}>Desfazer</Botao></div>
      </Dialogo>
    </div>
  );
}

function Cheques({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [sit, setSit] = useState<'receber' | 'recebidos' | 'depositados' | 'compensados' | 'devolvidos' | 'todos'>('receber');
  const lista = useQuery({ queryKey: ['cheques', eu.empresaAtivaId, sit], queryFn: () => api.get<{ itens: Cheque[]; resumo: { naMaoCentavos: number; depositadoCentavos: number; paraDepositar: number } }>(`/cheques?situacao=${sit}`) });
  const contas = useContas(true, true);
  const [acao, setAcao] = useState<null | { tipo: 'depositar' | 'compensar' | 'devolver'; c: Cheque }>(null);
  const [conta, setConta] = useState(''); const [data, setData] = useState(hojeIso()); const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post(`/cheques/${acao!.c.id}/${acao!.tipo}`, { data, contaId: acao!.tipo === 'depositar' ? conta : undefined, motivo: acao!.tipo === 'devolver' ? motivo : undefined }),
    onSuccess: () => { avisar('Cheque atualizado.'); setAcao(null); setErro(null); qc.invalidateQueries({ queryKey: ['cheques'] }); qc.invalidateQueries({ queryKey: ['caixa'] }); qc.invalidateQueries({ queryKey: ['receber'] }); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const cor = (s: Cheque['status']) => (s === 'COMPENSADO' ? <Pilula tipo="ok">✓ Compensado</Pilula> : s === 'DEVOLVIDO' ? <Pilula tipo="erro">✕ Devolvido</Pilula> : s === 'DEPOSITADO' ? <Pilula tipo="info">Depositado</Pilula> : s === 'CANCELADO' ? <Pilula>Cancelado</Pilula> : <Pilula tipo="neutra">Na mão</Pilula>);
  const r = lista.data?.resumo;
  return (
    <div className="pilha">
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <div className="cartao" style={{ padding: 16 }}><span className="peq mut">Na mão</span><br /><b className="num" style={{ textAlign: 'left', fontSize: 22 }}>{formatarBRL(r?.naMaoCentavos ?? 0)}</b></div>
        <div className="cartao" style={{ padding: 16 }}><span className="peq mut">Depositados, aguardando</span><br /><b className="num" style={{ textAlign: 'left', fontSize: 22 }}>{formatarBRL(r?.depositadoCentavos ?? 0)}</b></div>
        <div className="cartao" style={{ padding: 16 }}><span className="peq mut">Prontos para depositar</span><br /><b className="num" style={{ textAlign: 'left', fontSize: 22 }}>{r?.paraDepositar ?? 0}</b></div>
      </div>
      <div className="cartao pilha">
        <Selecao rotulo="Situação" value={sit} onChange={(e) => setSit(e.target.value as typeof sit)}><option value="receber">Aguardando (na mão e depositados)</option><option value="recebidos">Na mão</option><option value="depositados">Depositados</option><option value="compensados">Compensados</option><option value="devolvidos">Devolvidos</option><option value="todos">Todos</option></Selecao>
        {lista.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Cheque</th><th>Emitente</th><th>Laudo</th><th>Bom para</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.data?.itens.map((c) => (
                <tr key={c.id}><td><b>{c.numero}</b><div className="peq mut">{c.banco ?? ''}</div></td><td>{c.emitente}</td><td>{c.laudo}<div className="peq mut">{c.placa} · {c.cliente}</div></td><td>{dataBr(c.bomPara)}</td><td className="num">{formatarBRL(c.valorCentavos)}</td>
                  <td>{cor(c.status)}{c.contaDeposito && <div className="peq mut">{c.contaDeposito}</div>}{c.motivoDevolucao && <div className="peq mut">{c.motivoDevolucao}</div>}</td>
                  <td><div className="linha" style={{ gap: 6 }}>
                    {c.status === 'RECEBIDO' && <Botao variante="sec" pequeno disabled={!c.podeDepositar} title={c.podeDepositar ? '' : 'Ainda não é o dia combinado'} onClick={() => { setAcao({ tipo: 'depositar', c }); setErro(null); setData(hojeIso()); }}>Depositar</Botao>}
                    {c.status === 'DEPOSITADO' && <Botao variante="sec" pequeno onClick={() => { setAcao({ tipo: 'compensar', c }); setErro(null); setData(hojeIso()); }}>Compensou</Botao>}
                    {['RECEBIDO', 'DEPOSITADO', 'COMPENSADO'].includes(c.status) && <Botao variante="sec" pequeno onClick={() => { setAcao({ tipo: 'devolver', c }); setErro(null); setMotivo(''); setData(hojeIso()); }}>Devolvido</Botao>}</div></td></tr>
              ))}
              {lista.data?.itens.length === 0 && <tr><td colSpan={7} className="vazio">Nenhum cheque neste filtro.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      <Dialogo aberto={!!acao} onFechar={() => setAcao(null)} titulo={acao ? `${acao.tipo === 'depositar' ? 'Depositar' : acao.tipo === 'compensar' ? 'Compensação do' : 'Devolução do'} cheque ${acao.c.numero}` : ''}>
        {acao && <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {acao.tipo === 'depositar' && <Selecao rotulo="Conta do depósito" obrigatorio value={conta} onChange={(e) => setConta(e.target.value)}><option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>}
          {acao.tipo === 'compensar' && <Aviso tipo="info">Ao compensar, {formatarBRL(acao.c.valorCentavos)} entram na conta do depósito.</Aviso>}
          {acao.tipo === 'devolver' && <><Aviso tipo="aviso">A baixa do laudo é estornada e o título volta a ficar em aberto para cobrar de novo.{acao.c.status === 'COMPENSADO' ? ' O dinheiro sai da conta.' : ''}</Aviso><Campo rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} dica="Ex.: alínea 11, sem fundos." /></>}
          <Campo rotulo="Data" type="date" max={hojeIso()} value={data} onChange={(e) => setData(e.target.value)} />
          <Botao variante={acao.tipo === 'devolver' ? 'perigo' : 'primario'} carregando={m.isPending} onClick={() => m.mutate()}>Confirmar</Botao>
        </div>}
      </Dialogo>
    </div>
  );
}
