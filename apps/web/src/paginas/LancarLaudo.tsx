import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL, laudoSchema, normalizarPlaca } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, Carregando, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { CampoDinheiro, camposDoErro, checar, dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { ClienteItem, Empresa, Eu, FormaPagamento, Laudo, ResultadoLote, Servico, VistoriadorItem } from '../tipos';

type Duplicado = { numero: number; vistoriador: string };
const VAZIO = { placa: '', chassi: '', numeroLaudo: '', observacao: '', valorManual: null as number | null, valorCobrado: null as number | null, ajusteMotivo: '', motivoDuplicidade: '' };

export function LancarLaudo() {
  const { eu } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const [aba, setAba] = useState<'um' | 'lote'>('um');
  const ativa = eu.empresaAtivaId;
  const clientes = useQuery({ queryKey: ['clientes', ''], queryFn: () => api.get<ClienteItem[]>('/clientes?busca=') });
  const servicos = useQuery({ queryKey: ['servicos'], queryFn: () => api.get<Servico[]>('/servicos') });
  const formas = useQuery({ queryKey: ['formas'], queryFn: () => api.get<FormaPagamento[]>('/formas-pagamento') });
  const ehVis = eu.perfilAtivo === 'VISTORIADOR';
  const vist = useQuery({ queryKey: ['vistoriadores'], queryFn: () => api.get<VistoriadorItem[]>('/vistoriadores'), enabled: !ehVis });
  if (!ativa) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  if (clientes.isLoading || servicos.isLoading || formas.isLoading) return <Carregando />;
  const dados = {
    clientes: (clientes.data ?? []).filter((c) => c.status !== 'INATIVO'),
    servicos: (servicos.data ?? []).filter((s) => s.status !== 'INATIVO'),
    formas: (formas.data ?? []).filter((f) => f.status !== 'INATIVO'),
    vistoriadores: (vist.data ?? []).filter((v) => v.status === 'ATIVO' && v.empresaIds.includes(ativa)),
  };
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Lançar laudo</h1><p className="mut">{ehVis ? 'Lance os laudos do dia. O vistoriador é você.' : 'Lançamento manual na loja ativa.'}</p></div></div>
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)' }}>
        {([['um', 'Um laudo'], ['lote', 'Vários de uma vez']] as const).map(([id, r]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: aba === id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${aba === id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{r}</button>
        ))}
      </div>
      {aba === 'um' ? <Um eu={eu} dados={dados} /> : <Lote eu={eu} dados={dados} />}
      <Hoje />
    </div>
  );
}

interface Dados { clientes: ClienteItem[]; servicos: Servico[]; formas: FormaPagamento[]; vistoriadores: VistoriadorItem[] }

function Um({ eu, dados }: { eu: Eu; dados: Dados }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ehVis = eu.perfilAtivo === 'VISTORIADOR';
  const podeDesconto = eu.permissoes.includes('laudo.desconto');
  const [f, setF] = useState(VAZIO);
  const [ids, setIds] = useState({ clienteId: '', servicoId: '', formaPagamentoId: '', vistoriadorId: dados.vistoriadores.length === 1 ? dados.vistoriadores[0]!.id : '', dataLaudo: hojeIso() });
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);
  const [dup, setDup] = useState<{ itens: Duplicado[]; podeLiberar: boolean } | null>(null);
  const [liberar, setLiberar] = useState(false);
  const [diferente, setDiferente] = useState(false);

  const vig = useQuery({
    queryKey: ['preco-vigente', ids.clienteId, ids.servicoId, ids.dataLaudo], enabled: !!ids.clienteId && !!ids.servicoId,
    queryFn: () => api.get<{ preco: { valorCentavos: number } | null }>(`/precos/vigente?clienteId=${ids.clienteId}&servicoId=${ids.servicoId}&data=${ids.dataLaudo}`),
  });
  const tabela = vig.data ? (vig.data.preco?.valorCentavos ?? null) : undefined; // undefined = ainda não consultado

  const lancar = useMutation({
    mutationFn: (v: unknown) => api.post<Laudo>('/laudos', v),
    onSuccess: (l) => {
      qc.invalidateQueries({ queryKey: ['laudos'] });
      avisar(`Laudo nº ${l.numero} lançado: ${l.placa} · ${formatarBRL(l.valorCobradoCentavos)}`);
      setF({ ...VAZIO }); setDup(null); setLiberar(false); setDiferente(false); setErros({}); setErro(null);
      document.getElementById('placa')?.focus();
    },
    onError: (e) => {
      setErros(camposDoErro(e));
      const corpo = e instanceof ErroApi ? e.corpo : undefined;
      if (corpo?.codigo === 'DUPLICADO') { setDup({ itens: corpo.duplicados as Duplicado[], podeLiberar: !!corpo.podeLiberar }); setErro(null); }
      else setErro(mensagemDoErro(e));
    },
  });

  const enviar = () => {
    setErro(null);
    const corpo: Record<string, unknown> = {
      placa: f.placa, chassi: f.chassi, numeroLaudo: f.numeroLaudo, observacao: f.observacao, ...ids,
      vistoriadorId: ehVis ? undefined : ids.vistoriadorId,
      dataLaudo: ehVis ? undefined : ids.dataLaudo,
    };
    if (tabela === null) corpo.valorManualCentavos = f.valorManual ?? undefined;
    if (diferente && podeDesconto && tabela != null) { corpo.valorCobradoCentavos = f.valorCobrado ?? undefined; corpo.ajusteMotivo = f.ajusteMotivo; }
    if (liberar) { corpo.confirmarDuplicidade = true; corpo.motivoDuplicidade = f.motivoDuplicidade; }
    const r = checar(laudoSchema, corpo);
    if (r.erros) { setErros(r.erros); return; }
    setErros({}); lancar.mutate(r.dados);
  };

  const placaOk = normalizarPlaca(f.placa);
  return (
    <form className="cartao pilha" onSubmit={(e) => { e.preventDefault(); enviar(); }} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Campo id="placa" rotulo="Placa" obrigatorio value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} erro={erros.placa}
          dica={f.placa && placaOk ? `Placa ${placaOk}` : 'Padrão antigo ou Mercosul.'} autoFocus autoComplete="off" maxLength={8} />
        <Campo rotulo="Chassi" value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value.toUpperCase() })} erro={erros.chassi} dica="Opcional. 17 caracteres." autoComplete="off" />
        <Campo rotulo="Nº do laudo" value={f.numeroLaudo} onChange={(e) => setF({ ...f, numeroLaudo: e.target.value })} erro={erros.numeroLaudo} dica="Opcional. Não repete na loja." autoComplete="off" />
        {!ehVis && <Campo rotulo="Data do laudo" type="date" max={hojeIso()} value={ids.dataLaudo} onChange={(e) => setIds({ ...ids, dataLaudo: e.target.value })} erro={erros.dataLaudo} />}
      </div>
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Selecao rotulo="Cliente" obrigatorio value={ids.clienteId} onChange={(e) => setIds({ ...ids, clienteId: e.target.value })} erro={erros.clienteId}>
          <option value="">Escolha…</option>{dados.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </Selecao>
        <Selecao rotulo="Serviço" obrigatorio value={ids.servicoId} onChange={(e) => setIds({ ...ids, servicoId: e.target.value })} erro={erros.servicoId}>
          <option value="">Escolha…</option>{dados.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </Selecao>
        <Selecao rotulo="Forma de pagamento" obrigatorio value={ids.formaPagamentoId} onChange={(e) => setIds({ ...ids, formaPagamentoId: e.target.value })} erro={erros.formaPagamentoId}>
          <option value="">Escolha…</option>{dados.formas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </Selecao>
        {!ehVis && (
          <Selecao rotulo="Vistoriador" obrigatorio value={ids.vistoriadorId} onChange={(e) => setIds({ ...ids, vistoriadorId: e.target.value })} erro={erros.vistoriadorId}
            dica={dados.vistoriadores.length === 0 ? 'Nenhum vistoriador ativo nesta loja. Cadastre em Cadastros.' : undefined}>
            <option value="">Escolha…</option>{dados.vistoriadores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </Selecao>
        )}
      </div>

      {ids.clienteId && ids.servicoId && (
        <div className="cartao pilha" style={{ background: 'var(--suave)', padding: 16 }} aria-live="polite">
          {vig.isLoading ? <span className="mut">Consultando preço…</span> : tabela == null ? (
            <>
              <Aviso tipo="aviso">Este cliente não tem preço cadastrado para este serviço nesta data. Informe o valor deste laudo; o gerente vai revisar depois.</Aviso>
              <CampoDinheiro key={`m${ids.clienteId}${ids.servicoId}`} rotulo="Valor do laudo (R$)" obrigatorio centavos={f.valorManual} onChange={(c) => setF({ ...f, valorManual: c })} erro={erros.valorManualCentavos} />
            </>
          ) : (
            <>
              <div className="linha entre"><span>Preço de tabela</span><b className="num" style={{ fontSize: 22 }}>{formatarBRL(diferente && f.valorCobrado != null ? f.valorCobrado : tabela)}</b></div>
              {diferente && f.valorCobrado != null && f.valorCobrado !== tabela && <span className="peq mut">Tabela: {formatarBRL(tabela)} · {f.valorCobrado < tabela ? 'desconto' : 'acréscimo'} de {formatarBRL(Math.abs(tabela - f.valorCobrado))}</span>}
              {podeDesconto && (
                <label className="check"><input type="checkbox" checked={diferente} onChange={(e) => setDiferente(e.target.checked)} />Cobrar valor diferente da tabela</label>
              )}
              {podeDesconto && diferente && (
                <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  <CampoDinheiro rotulo="Valor cobrado (R$)" obrigatorio centavos={f.valorCobrado} onChange={(c) => setF({ ...f, valorCobrado: c })} erro={erros.valorCobradoCentavos} />
                  <Campo rotulo="Motivo" obrigatorio value={f.ajusteMotivo} onChange={(e) => setF({ ...f, ajusteMotivo: e.target.value })} erro={erros.ajusteMotivo} />
                </div>
              )}
            </>
          )}
        </div>
      )}
      <AreaTexto rotulo="Observação" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} erro={erros.observacao} rows={2} />

      {dup && (
        <Aviso tipo="aviso">
          <div className="pilha" style={{ gap: 8 }}>
            <b>Possível lançamento em duplicidade</b>
            <span>Já existe laudo desta placa para este serviço nesta data: {dup.itens.map((d) => `nº ${d.numero} (${d.vistoriador})`).join(', ')}.</span>
            {dup.podeLiberar ? (
              <>
                <label className="check"><input type="checkbox" checked={liberar} onChange={(e) => setLiberar(e.target.checked)} />Lançar mesmo assim (é outro laudo de verdade)</label>
                {liberar && <Campo rotulo="Motivo" obrigatorio value={f.motivoDuplicidade} onChange={(e) => setF({ ...f, motivoDuplicidade: e.target.value })} erro={erros.motivoDuplicidade} />}
              </>
            ) : <span>Se for outro laudo mesmo, peça ao gerente para lançar.</span>}
          </div>
        </Aviso>
      )}
      <div className="linha"><Botao type="submit" carregando={lancar.isPending}>Lançar laudo</Botao><span className="peq mut">Depois de lançar, o cursor volta para a placa.</span></div>
    </form>
  );
}

interface LinhaLote { placa: string; numeroLaudo: string; clienteId: string; servicoId: string; formaPagamentoId: string; valor: number | null }
const linhaVazia = (base?: LinhaLote): LinhaLote => ({ placa: '', numeroLaudo: '', clienteId: base?.clienteId ?? '', servicoId: base?.servicoId ?? '', formaPagamentoId: base?.formaPagamentoId ?? '', valor: null });

function Lote({ eu, dados }: { eu: Eu; dados: Dados }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ehVis = eu.perfilAtivo === 'VISTORIADOR';
  const [linhas, setLinhas] = useState<LinhaLote[]>([linhaVazia(), linhaVazia(), linhaVazia()]);
  const [vistoriadorId, setVist] = useState(dados.vistoriadores.length === 1 ? dados.vistoriadores[0]!.id : '');
  const [dataLaudo, setData] = useState(hojeIso());
  const [res, setRes] = useState<ResultadoLote[] | null>(null); const [erro, setErro] = useState<string | null>(null);
  const muda = (i: number, p: Partial<LinhaLote>) => setLinhas(linhas.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const envio = useMutation({
    mutationFn: (itens: unknown[]) => api.post<{ lancados: number; erros: number; resultados: ResultadoLote[] }>('/laudos/lote', { dataLaudo: ehVis ? undefined : dataLaudo, vistoriadorId: ehVis ? undefined : vistoriadorId, itens }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['laudos'] });
      setRes(r.resultados);
      // sobram só as linhas com erro, para corrigir e reenviar
      const preenchidas = linhas.filter((l) => l.placa.trim());
      setLinhas(r.erros === 0 ? [linhaVazia(preenchidas[0]), linhaVazia(preenchidas[0]), linhaVazia(preenchidas[0])] : r.resultados.filter((x) => !x.ok).map((x) => preenchidas[x.linha]!));
      avisar(r.erros === 0 ? `${r.lancados} laudos lançados.` : `${r.lancados} lançados, ${r.erros} com problema.`, r.erros ? 'erro' : 'ok');
    },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const enviar = () => {
    setErro(null); setRes(null);
    const preenchidas = linhas.filter((l) => l.placa.trim());
    if (preenchidas.length === 0) { setErro('Preencha ao menos uma placa.'); return; }
    if (!ehVis && !vistoriadorId) { setErro('Escolha o vistoriador.'); return; }
    envio.mutate(preenchidas.map((l) => ({ placa: l.placa, numeroLaudo: l.numeroLaudo, clienteId: l.clienteId, servicoId: l.servicoId, formaPagamentoId: l.formaPagamentoId, valorManualCentavos: l.valor ?? undefined })));
  };
  const preenchidas = linhas.filter((l) => l.placa.trim());
  return (
    <div className="cartao pilha">
      <p className="mut">Para quando o movimento vem em bloco: o mesmo vistoriador e a mesma data, até 50 laudos. Linhas com problema voltam com o motivo; as boas entram.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!ehVis && (
        <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Selecao rotulo="Vistoriador" obrigatorio value={vistoriadorId} onChange={(e) => setVist(e.target.value)}><option value="">Escolha…</option>{dados.vistoriadores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}</Selecao>
          <Campo rotulo="Data dos laudos" type="date" max={hojeIso()} value={dataLaudo} onChange={(e) => setData(e.target.value)} />
        </div>
      )}
      <div className="tw"><table>
        <thead><tr><th>Placa</th><th>Nº laudo</th><th>Cliente</th><th>Serviço</th><th>Forma</th><th>Valor (se sem preço)</th><th /></tr></thead>
        <tbody>
          {linhas.map((l, i) => {
            return (
              <tr key={i}>
                <td><input aria-label={`Placa da linha ${i + 1}`} value={l.placa} onChange={(e) => muda(i, { placa: e.target.value.toUpperCase() })} style={{ width: 110 }} maxLength={8} /></td>
                <td><input aria-label={`Nº do laudo da linha ${i + 1}`} value={l.numeroLaudo} onChange={(e) => muda(i, { numeroLaudo: e.target.value })} style={{ width: 100 }} /></td>
                <td><select aria-label={`Cliente da linha ${i + 1}`} value={l.clienteId} onChange={(e) => muda(i, { clienteId: e.target.value })}><option value="">—</option>{dados.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></td>
                <td><select aria-label={`Serviço da linha ${i + 1}`} value={l.servicoId} onChange={(e) => muda(i, { servicoId: e.target.value })}><option value="">—</option>{dados.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></td>
                <td><select aria-label={`Forma da linha ${i + 1}`} value={l.formaPagamentoId} onChange={(e) => muda(i, { formaPagamentoId: e.target.value })}><option value="">—</option>{dados.formas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></td>
                <td><input aria-label={`Valor da linha ${i + 1}`} inputMode="decimal" placeholder="0,00" style={{ width: 90 }} onChange={(e) => muda(i, { valor: e.target.value.trim() ? Math.round(Number(e.target.value.replace(/\./g, '').replace(',', '.')) * 100) || null : null })} /></td>
                <td><Botao variante="sec" pequeno type="button" onClick={() => setLinhas(linhas.filter((_, k) => k !== i))} aria-label={`Remover linha ${i + 1}`}>Tirar</Botao></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {res && (
        <div className="pilha" style={{ gap: 6 }} role="status">
          {res.map((x) => (
            <div key={x.linha} className="linha" style={{ alignItems: 'center' }}>
              {x.ok ? <Pilula tipo="ok">✓ Lançado</Pilula> : <Pilula tipo="erro">✕ Não lançado</Pilula>}
              <span>{x.ok ? `${x.laudo!.placa} · nº ${x.laudo!.numero} · ${formatarBRL(x.laudo!.valorCobradoCentavos)}` : `Linha ${x.linha + 1}: ${x.erro}`}</span>
            </div>
          ))}
        </div>
      )}
      <div className="linha">
        <Botao variante="sec" type="button" disabled={linhas.length >= 50} onClick={() => setLinhas([...linhas, linhaVazia(linhas[linhas.length - 1])])}>Mais uma linha</Botao>
        <Botao type="button" carregando={envio.isPending} onClick={enviar}>Lançar {preenchidas.length || ''} laudos</Botao>
      </div>
    </div>
  );
}

function Hoje() {
  const hoje = hojeIso();
  const lista = useQuery({ queryKey: ['laudos', 'hoje', hoje], queryFn: () => api.get<{ itens: Laudo[] }>(`/laudos?de=${hoje}&ate=${hoje}&limite=20`) });
  return (
    <div className="cartao pilha">
      <h2>Lançados hoje ({dataBr(hoje)})</h2>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Nº</th><th>Placa</th><th>Cliente</th><th>Serviço</th><th>Vistoriador</th><th>Valor</th><th>Situação</th></tr></thead>
          <tbody>
            {lista.data?.itens.map((l) => (
              <tr key={l.id}><td>{l.numero}</td><td><b>{l.placa}</b></td><td>{l.cliente}</td><td>{l.servico}</td><td>{l.vistoriador}</td>
                <td className="num">{formatarBRL(l.valorCobradoCentavos)}</td>
                <td>{l.status === 'CANCELADO' ? <Pilula tipo="erro">✕ Cancelado</Pilula> : l.precoManual && !l.revisadoEm ? <Pilula tipo="aviso">Valor manual</Pilula> : <Pilula tipo="ok">✓ Lançado</Pilula>}</td></tr>
            ))}
            {lista.data?.itens.length === 0 && <tr><td colSpan={7} className="vazio">Nada lançado hoje ainda.</td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
