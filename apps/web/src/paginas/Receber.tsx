import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { CampoDinheiro, dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { ClienteItem, ConfigFinanceira, ContaCaixa, Eu, FormaPagamento, SimulacaoBaixa, TituloDetalhe, TituloItem } from '../tipos';

const SITUACAO = { abertos: 'Em aberto', vencidos: 'Vencidos', quitados: 'Quitados', cancelados: 'Cancelados', todos: 'Todos' } as const;
type Sit = keyof typeof SITUACAO;

function pilulaTitulo(t: Pick<TituloItem, 'status' | 'vencido'>) {
  if (t.status === 'QUITADO') return <Pilula tipo="ok">✓ Quitado</Pilula>;
  if (t.status === 'CANCELADO') return <Pilula>Cancelado</Pilula>;
  if (t.vencido) return <Pilula tipo="erro">! Vencido</Pilula>;
  return t.status === 'PARCIAL' ? <Pilula tipo="info">Parcial</Pilula> : <Pilula tipo="neutra">Em aberto</Pilula>;
}

export const tipoDeForma = (formas: FormaPagamento[] | undefined, id: string, padrao?: string) => (id ? formas?.find((x) => x.id === id)?.tipo : padrao);

export function Receber() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const qc = useQueryClient();
  const [f, setF] = useState({ situacao: 'abertos' as Sit, clienteId: '', placa: '', vencDe: '', vencAte: '' });
  const [aplicado, setAplicado] = useState(f);
  const [pagina, setPagina] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [lote, setLote] = useState(false); const [regras, setRegras] = useState(false);
  const ativa = eu.empresaAtivaId;
  const clientes = useQuery({ queryKey: ['clientes', ''], queryFn: () => api.get<ClienteItem[]>('/clientes?busca='), enabled: !!ativa });
  const resumo = useQuery({ queryKey: ['receber', 'resumo', ativa], enabled: !!ativa, queryFn: () => api.get<{ aReceberCentavos: number; vencidoCentavos: number; venceEm7DiasCentavos: number; recebidoNoMesCentavos: number; titulosAbertos: number }>('/receber/resumo') });
  const qs = new URLSearchParams({ situacao: aplicado.situacao, limite: '100', pagina: String(pagina) });
  (['clienteId', 'placa', 'vencDe', 'vencAte'] as const).forEach((k) => { if (aplicado[k]) qs.set(k, aplicado[k]); });
  const lista = useQuery({ queryKey: ['receber', 'lista', ativa, qs.toString()], enabled: !!ativa, queryFn: () => api.get<{ itens: TituloItem[]; total: number; saldoAbertoCentavos: number }>(`/receber/titulos?${qs}`) });
  if (!ativa) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  const baixaveis = (lista.data?.itens ?? []).filter((t) => t.status === 'ABERTO' || t.status === 'PARCIAL');
  const marcados = baixaveis.filter((t) => sel.has(t.id));
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['receber'] }); qc.invalidateQueries({ queryKey: ['caixa'] }); qc.invalidateQueries({ queryKey: ['laudos'] }); };
  const podeBaixar = eu.permissoes.includes('receber.baixar');

  return (
    <div className="pilha estreito">
      <div className="cabeca">
        <div><h1>A receber</h1><p className="mut">Um título por laudo. Baixe total ou parcialmente; multa e juros de atraso são calculados no dia do recebimento.</p></div>
        {eu.rede && <Botao variante="sec" onClick={() => setRegras(true)}>Regras financeiras da loja</Botao>}
      </div>
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {([['A receber', resumo.data?.aReceberCentavos, `${resumo.data?.titulosAbertos ?? 0} títulos`], ['Vencido', resumo.data?.vencidoCentavos, 'precisa de cobrança'], ['Vence em 7 dias', resumo.data?.venceEm7DiasCentavos, 'a próxima semana'], ['Recebido no mês', resumo.data?.recebidoNoMesCentavos, 'já no caixa']] as const).map(([r, v, d]) => (
          <div key={r} className="cartao" style={{ padding: 16 }}><span className="peq mut">{r}</span><br /><b className="num" style={{ textAlign: 'left', fontSize: 22, color: r === 'Vencido' && (v ?? 0) > 0 ? 'var(--erro)' : undefined }}>{formatarBRL(v ?? 0)}</b><br /><span className="peq mut">{d}</span></div>
        ))}
      </div>
      <form className="cartao" onSubmit={(e) => { e.preventDefault(); setPagina(0); setSel(new Set()); setAplicado(f); }}>
        <div className="linha">
          <Selecao rotulo="Situação" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value as Sit })}>{(Object.keys(SITUACAO) as Sit[]).map((k) => <option key={k} value={k}>{SITUACAO[k]}</option>)}</Selecao>
          <Selecao rotulo="Cliente" value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })}><option value="">Todos</option>{clientes.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
          <Campo rotulo="Placa" value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} style={{ width: 120 }} />
          <Campo rotulo="Vence de" type="date" value={f.vencDe} onChange={(e) => setF({ ...f, vencDe: e.target.value })} />
          <Campo rotulo="até" type="date" value={f.vencAte} onChange={(e) => setF({ ...f, vencAte: e.target.value })} />
          <Botao type="submit">Filtrar</Botao>
        </div>
      </form>
      <div className="cartao pilha">
        <div className="linha entre">
          <span className="mut">{lista.data ? `${lista.data.total} títulos · saldo em aberto ${formatarBRL(lista.data.saldoAbertoCentavos)}` : ' '}</span>
          {podeBaixar && <Botao disabled={marcados.length === 0} onClick={() => setLote(true)}>Baixar {marcados.length || ''} selecionados</Botao>}
        </div>
        {lista.isLoading ? <Carregando /> : lista.isError ? <Aviso tipo="erro">{mensagemDoErro(lista.error)}</Aviso> : (
          <div className="tw"><table>
            <thead><tr>{podeBaixar && <th><span className="sr">Selecionar</span></th>}<th>Laudo</th><th>Placa</th><th>Cliente</th><th>Serviço</th><th>Vence</th><th className="num">Valor</th><th className="num">Saldo</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.data?.itens.map((t) => (
                <tr key={t.id}>
                  {podeBaixar && <td>{(t.status === 'ABERTO' || t.status === 'PARCIAL') && <input type="checkbox" aria-label={`Selecionar laudo ${t.numero}`} checked={sel.has(t.id)} onChange={() => alternar(t.id)} />}</td>}
                  <td><button type="button" onClick={() => setDetalhe(t.id)} style={{ background: 'none', border: 0, color: 'var(--verde)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>{t.numero}</button></td>
                  <td><b>{t.placa}</b></td><td>{t.cliente}</td><td>{t.servico}<div className="peq mut">{t.forma}</div></td>
                  <td>{dataBr(t.vencimento)}{t.vencido && <div className="peq" style={{ color: 'var(--erro)' }}>{t.diasAtraso} dias de atraso</div>}</td>
                  <td className="num">{formatarBRL(t.valorCentavos)}</td>
                  <td className="num">{formatarBRL(t.saldoCentavos)}{t.encargosCentavos > 0 && <div className="peq mut">+ {formatarBRL(t.encargosCentavos)} de encargos</div>}</td>
                  <td>{pilulaTitulo(t)}</td>
                </tr>
              ))}
              {lista.data?.itens.length === 0 && <tr><td colSpan={9} className="vazio">Nenhum título com estes filtros.</td></tr>}
            </tbody>
          </table></div>
        )}
        <div className="linha entre">
          <Botao variante="sec" pequeno disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>← Anteriores</Botao>
          <Botao variante="sec" pequeno disabled={!lista.data || (pagina + 1) * 100 >= lista.data.total} onClick={() => setPagina(pagina + 1)}>Próximos →</Botao>
        </div>
      </div>
      <DetalheTitulo id={detalhe} eu={eu} onFechar={() => setDetalhe(null)} onMudou={recarregar} />
      <BaixaLote aberto={lote} titulos={marcados} onFechar={() => setLote(false)} onOk={() => { setLote(false); setSel(new Set()); recarregar(); }} />
      <Regras aberto={regras} onFechar={() => setRegras(false)} />
    </div>
  );
}

function SelecaoContaForma({ conta, setConta, forma, setForma, erros, tipoPadrao }: { conta: string; setConta: (v: string) => void; forma: string; setForma: (v: string) => void; erros?: Record<string, string>; tipoPadrao?: string }) {
  const contas = useQuery({ queryKey: ['caixa', 'contas-sel'], queryFn: () => api.get<{ contas: ContaCaixa[] }>('/caixa/contas') });
  const formas = useQuery({ queryKey: ['formas'], queryFn: () => api.get<FormaPagamento[]>('/formas-pagamento') });
  const tipo = forma ? formas.data?.find((x) => x.id === forma)?.tipo : tipoPadrao;
  const semConta = tipo === 'CARTAO_DEBITO' || tipo === 'CARTAO_CREDITO' || tipo === 'CHEQUE';
  return (
    <div className="pilha" style={{ gap: 8 }}>
      <div className="linha">
        {!semConta && (
          <Selecao rotulo="Conta em que entrou" obrigatorio value={conta} onChange={(e) => setConta(e.target.value)} erro={erros?.contaId}>
            <option value="">Escolha…</option>{contas.data?.contas.filter((c) => c.status === 'ATIVO').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Selecao>
        )}
        <Selecao rotulo="Forma de pagamento" value={forma} onChange={(e) => setForma(e.target.value)} dica="Vazio mantém a do laudo."><option value="">Como no laudo</option>{formas.data?.filter((x) => x.status !== 'INATIVO').map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
      </div>
      {tipo === 'CARTAO_DEBITO' || tipo === 'CARTAO_CREDITO' ? <Aviso tipo="info">Cartão: o valor entra como venda a receber da operadora, já com a taxa descontada. O dinheiro entra no caixa quando a operadora pagar (tela Cartões e cheques).</Aviso> : null}
      {tipo === 'CHEQUE' ? <Aviso tipo="info">Cheque: o dinheiro só entra no caixa quando o cheque compensar (tela Cartões e cheques).</Aviso> : null}
    </div>
  );
}

function DetalheTitulo({ id, eu, onFechar, onMudou }: { id: string | null; eu: Eu; onFechar: () => void; onMudou: () => void }) {
  const { avisar } = useToast();
  const d = useQuery({ queryKey: ['receber', 'detalhe', id], enabled: !!id, queryFn: () => api.get<TituloDetalhe>(`/receber/titulos/${id}`) });
  const [modo, setModo] = useState<null | 'baixar' | { estornar: string }>(null);
  const [f, setF] = useState({ data: hojeIso(), principal: null as number | null, conta: '', forma: '', perdoar: false, motivo: '' });
  const [ch, setCh] = useState({ numero: '', banco: '', emitente: '', bomPara: hojeIso() });
  const formasQ = useQuery({ queryKey: ['formas'], queryFn: () => api.get<FormaPagamento[]>('/formas-pagamento') });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const t = d.data;
  const tipoEfetivo = tipoDeForma(formasQ.data, f.forma, t?.formaTipo);
  const aberto = t && (t.status === 'ABERTO' || t.status === 'PARCIAL');
  const sim = useQuery({
    queryKey: ['receber', 'sim', id, f.data, f.principal], enabled: !!id && modo === 'baixar',
    queryFn: () => api.get<SimulacaoBaixa>(`/receber/titulos/${id}/simular?data=${f.data}${f.principal ? `&principal=${f.principal}` : ''}`),
  });
  const fechar = () => { setModo(null); setErro(null); setCampos({}); onFechar(); };
  const baixar = useMutation({
    mutationFn: () => api.post(`/receber/titulos/${id}/baixas`, { data: f.data, principalCentavos: f.principal ?? undefined, contaId: f.conta || undefined, formaPagamentoId: f.forma || undefined, perdoarEncargos: f.perdoar || undefined, motivo: f.motivo || undefined, cheque: tipoEfetivo === 'CHEQUE' ? { numero: ch.numero, banco: ch.banco || undefined, emitente: ch.emitente, bomPara: ch.bomPara } : undefined }),
    onSuccess: () => { avisar('Recebimento registrado.'); onMudou(); setModo(null); setErro(null); setCampos({}); d.refetch(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  const estornar = useMutation({
    mutationFn: (baixaId: string) => api.post(`/receber/baixas/${baixaId}/estornar`, { motivo: f.motivo }),
    onSuccess: () => { avisar('Baixa estornada.'); onMudou(); setModo(null); setErro(null); d.refetch(); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const encargos = (sim.data?.multaCentavos ?? 0) + (sim.data?.jurosCentavos ?? 0);
  return (
    <Dialogo aberto={!!id} onFechar={fechar} titulo={t ? `Laudo nº ${t.numero} · ${t.placa}` : 'Título'} lateral>
      {!t ? <Carregando /> : (
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="linha">{pilulaTitulo(t)}{t.faturaId && <Pilula tipo="info">Em fatura</Pilula>}</div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
            {([['Cliente', t.cliente], ['Serviço', t.servico], ['Forma', t.forma], ['Data do laudo', dataBr(t.dataLaudo)], ['Vencimento', dataBr(t.vencimento)], ['Valor', formatarBRL(t.valorCentavos)], ['Recebido', formatarBRL(t.pagoCentavos)], ['Saldo', formatarBRL(t.saldoCentavos)]] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt className="mut">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>
            ))}
          </dl>
          {t.motivoCancelamento && <Aviso tipo="info">{t.motivoCancelamento}</Aviso>}
          <h3>Baixas</h3>
          {t.baixas.length === 0 ? <span className="mut">Nenhum recebimento ainda.</span> : (
            <div className="tw"><table>
              <thead><tr><th>Data</th><th className="num">Principal</th><th className="num">Encargos</th><th className="num">Recebido</th><th /></tr></thead>
              <tbody>{t.baixas.map((b) => (
                <tr key={b.id}><td>{dataBr(b.data)}<div className="peq mut">{b.forma}{b.conta ? ` · ${b.conta}` : ''}</div></td>
                  <td className="num">{formatarBRL(b.principalCentavos)}</td>
                  <td className="num">{formatarBRL(b.multaCentavos + b.jurosCentavos - b.perdaoCentavos)}{b.perdaoCentavos !== 0 && <div className="peq mut">perdão {formatarBRL(b.perdaoCentavos)}</div>}</td>
                  <td className="num">{formatarBRL(b.recebidoCentavos)}</td>
                  <td>{b.estornoDe ? <Pilula tipo="aviso">Estorno</Pilula> : b.estornada ? <Pilula>Estornada</Pilula> : (eu.permissoes.includes('receber.estornar') || eu.permissoes.includes('receber.estornar_periodo_aberto')) && <Botao variante="sec" pequeno onClick={() => { setModo({ estornar: b.id }); setF({ ...f, motivo: '' }); }}>Estornar</Botao>}
                    {b.motivo && <div className="peq mut">{b.motivo}</div>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {aberto && modo === null && eu.permissoes.includes('receber.baixar') && <Botao onClick={() => { setModo('baixar'); setF({ data: hojeIso(), principal: null, conta: '', forma: '', perdoar: false, motivo: '' }); }}>Registrar recebimento</Botao>}
          {modo === 'baixar' && (
            <div className="cartao pilha" style={{ background: 'var(--suave)' }}>
              <h3>Registrar recebimento</h3>
              <div className="linha">
                <Campo rotulo="Data do recebimento" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} erro={campos.data} />
                <CampoDinheiro rotulo="Valor do título a baixar (R$)" centavos={f.principal} onChange={(v) => setF({ ...f, principal: v })} erro={campos.principalCentavos} dica={`Vazio quita o saldo (${formatarBRL(t.saldoCentavos)}).`} />
              </div>
              <SelecaoContaForma conta={f.conta} setConta={(v) => setF({ ...f, conta: v })} forma={f.forma} setForma={(v) => setF({ ...f, forma: v })} erros={campos} tipoPadrao={t.formaTipo} />
              {tipoEfetivo === 'CHEQUE' && (
                <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                  <Campo rotulo="Nº do cheque" obrigatorio value={ch.numero} onChange={(e) => setCh({ ...ch, numero: e.target.value })} erro={campos['cheque.numero']} />
                  <Campo rotulo="Banco" value={ch.banco} onChange={(e) => setCh({ ...ch, banco: e.target.value })} />
                  <Campo rotulo="Emitente" obrigatorio value={ch.emitente} onChange={(e) => setCh({ ...ch, emitente: e.target.value })} erro={campos['cheque.emitente']} />
                  <Campo rotulo="Bom para" type="date" obrigatorio value={ch.bomPara} onChange={(e) => setCh({ ...ch, bomPara: e.target.value })} erro={campos['cheque.bomPara']} />
                </div>
              )}
              {sim.data && (
                <div className="pilha" style={{ gap: 4 }} aria-live="polite">
                  <div className="linha entre"><span>Valor do título</span><span className="num">{formatarBRL(sim.data.principalCentavos)}</span></div>
                  {sim.data.diasAtraso > 0 && <><div className="linha entre"><span>Multa ({sim.data.diasAtraso} dias de atraso)</span><span className="num">{formatarBRL(sim.data.multaCentavos)}</span></div>
                    <div className="linha entre"><span>Juros</span><span className="num">{formatarBRL(sim.data.jurosCentavos)}</span></div></>}
                  <div className="linha entre"><b>Total a receber</b><b className="num" style={{ fontSize: 20 }}>{formatarBRL(sim.data.totalCentavos - (f.perdoar ? encargos : 0))}</b></div>
                </div>
              )}
              {encargos > 0 && <label className="check"><input type="checkbox" checked={f.perdoar} onChange={(e) => setF({ ...f, perdoar: e.target.checked })} />Perdoar multa e juros</label>}
              {f.perdoar && <Campo rotulo="Motivo do perdão" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} erro={campos.motivo} />}
              <div className="linha"><Botao carregando={baixar.isPending} onClick={() => baixar.mutate()}>Confirmar recebimento</Botao><Botao variante="sec" onClick={() => { setModo(null); setErro(null); }}>Voltar</Botao></div>
            </div>
          )}
          {modo && typeof modo === 'object' && (
            <div className="pilha">
              <Campo rotulo="Motivo do estorno" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} dica="Mínimo de 5 caracteres. O dinheiro sai da conta de novo." />
              <div className="linha"><Botao variante="perigo" carregando={estornar.isPending} onClick={() => estornar.mutate(modo.estornar)}>Estornar baixa</Botao><Botao variante="sec" onClick={() => { setModo(null); setErro(null); }}>Voltar</Botao></div>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  );
}

function BaixaLote({ aberto, titulos, onFechar, onOk }: { aberto: boolean; titulos: TituloItem[]; onFechar: () => void; onOk: () => void }) {
  const { avisar } = useToast();
  const [f, setF] = useState({ data: hojeIso(), conta: '', forma: '', perdoar: false, motivo: '' });
  const [erro, setErro] = useState<string | null>(null); const [res, setRes] = useState<{ tituloId: string; ok: boolean; erro?: string }[] | null>(null);
  const total = titulos.reduce((s, t) => s + t.saldoCentavos + t.encargosCentavos, 0);
  const m = useMutation({
    mutationFn: () => api.post<{ baixados: number; erros: number; resultados: { tituloId: string; ok: boolean; erro?: string }[] }>('/receber/baixas-lote', { itens: titulos.map((t) => ({ tituloId: t.id })), data: f.data, contaId: f.conta || undefined, formaPagamentoId: f.forma || undefined, perdoarEncargos: f.perdoar || undefined, motivo: f.motivo || undefined }),
    onSuccess: (r) => { setRes(r.resultados); avisar(r.erros ? `${r.baixados} baixados, ${r.erros} com problema.` : `${r.baixados} títulos baixados.`); if (!r.erros) onOk(); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo={`Baixar ${titulos.length} títulos`}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p className="mut">Quita o saldo de cada título. Multa e juros são calculados na data escolhida, título a título (estimativa de hoje: {formatarBRL(total)}).</p>
        <Campo rotulo="Data do recebimento" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        <SelecaoContaForma conta={f.conta} setConta={(v) => setF({ ...f, conta: v })} forma={f.forma} setForma={(v) => setF({ ...f, forma: v })} />
        <label className="check"><input type="checkbox" checked={f.perdoar} onChange={(e) => setF({ ...f, perdoar: e.target.checked })} />Perdoar multa e juros de todos</label>
        {f.perdoar && <Campo rotulo="Motivo do perdão" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />}
        {res && res.filter((r) => !r.ok).map((r) => <Aviso key={r.tituloId} tipo="erro">{titulos.find((t) => t.id === r.tituloId)?.placa}: {r.erro}</Aviso>)}
        <div className="linha"><Botao carregando={m.isPending} onClick={() => m.mutate()}>Baixar</Botao>{res && <Botao variante="sec" onClick={onOk}>Fechar</Botao>}</div>
      </div>
    </Dialogo>
  );
}

function Regras({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const c = useQuery({ queryKey: ['receber', 'config'], enabled: aberto, queryFn: () => api.get<ConfigFinanceira>('/receber/config') });
  const [f, setF] = useState<ConfigFinanceira | null>(null);
  if (c.data && !f) setF(c.data);
  const m = useMutation({ mutationFn: () => api.put('/receber/config', f), onSuccess: () => { qc.invalidateQueries({ queryKey: ['receber', 'config'] }); avisar('Regras salvas.'); onFechar(); }, onError: (e) => avisar(mensagemDoErro(e), 'erro') });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Regras financeiras da loja">
      {!f ? <Carregando /> : (
        <div className="pilha">
          <CampoDinheiro rotulo="Quanto o Financeiro pode perdoar de multa e juros, por baixa (R$)" centavos={f.perdaoLimiteCentavos} onChange={(v) => setF({ ...f, perdaoLimiteCentavos: v ?? 0 })} dica="Acima disso, só Gerente e Administrativo perdoam." />
          <label className="check"><input type="checkbox" checked={f.aprovacaoPagarObrigatoria} onChange={(e) => setF({ ...f, aprovacaoPagarObrigatoria: e.target.checked })} />Contas a pagar precisam de aprovação (quem cria não aprova)</label>
          <label className="check"><input type="checkbox" checked={f.financeiroAprovaPagar} onChange={(e) => setF({ ...f, financeiroAprovaPagar: e.target.checked })} />O Financeiro também pode aprovar contas a pagar</label>
          <label className="check"><input type="checkbox" checked={f.financeiroVeDre} onChange={(e) => setF({ ...f, financeiroVeDre: e.target.checked })} />O Financeiro vê DRE e balanço</label>
          <Botao carregando={m.isPending} onClick={() => m.mutate()}>Salvar</Botao>
        </div>
      )}
    </Dialogo>
  );
}
