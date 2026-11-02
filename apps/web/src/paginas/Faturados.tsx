import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL, periodoSugerido } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { API_BASE, api } from '../api';
import { CampoDinheiro, dataBr, hojeIso, mensagemDoErro, plural } from '../formulario';
import type { ClienteItem, ContaCaixa, Eu, FaturaDetalhe, FaturaItem, FormaPagamento, PixFatura, PreviaCliente } from '../tipos';

const SITUACAO = { abertas: 'Em aberto', vencidas: 'Vencidas', pagas: 'Pagas', canceladas: 'Canceladas', todas: 'Todas' } as const;
type Sit = keyof typeof SITUACAO;
const PERIODICIDADE = { SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal' } as const;

const pilula = (f: Pick<FaturaItem, 'status' | 'vencida'>) =>
  f.status === 'PAGA' ? <Pilula tipo="ok">✓ Paga</Pilula> : f.status === 'CANCELADA' ? <Pilula>Cancelada</Pilula> : f.vencida ? <Pilula tipo="erro">! Vencida</Pilula> : f.status === 'PARCIAL' ? <Pilula tipo="info">Parcial</Pilula> : <Pilula tipo="neutra">Em aberto</Pilula>;

export function Faturados() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const ativa = eu.empresaAtivaId;
  const [f, setF] = useState({ situacao: 'abertas' as Sit, clienteId: '', de: '', ate: '' });
  const [aplicado, setAplicado] = useState(f);
  const [sel, setSel] = useState<string | null>(null); const [gerar, setGerar] = useState(false); const [cobranca, setCobranca] = useState(false);
  const clientes = useQuery({ queryKey: ['clientes', ''], queryFn: () => api.get<ClienteItem[]>('/clientes?busca='), enabled: !!ativa });
  const qs = new URLSearchParams({ situacao: aplicado.situacao });
  (['clienteId', 'de', 'ate'] as const).forEach((k) => { if (aplicado[k]) qs.set(k, aplicado[k]); });
  const lista = useQuery({ queryKey: ['faturas', 'lista', ativa, qs.toString()], enabled: !!ativa, queryFn: () => api.get<{ itens: FaturaItem[]; total: number }>(`/faturas?${qs}`) });
  if (!ativa) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  const itens = lista.data?.itens ?? [];
  const saldo = itens.filter((i) => i.status === 'ABERTA' || i.status === 'PARCIAL').reduce((s, i) => s + i.saldoCentavos, 0);
  return (
    <div className="pilha estreito">
      <div className="cabeca">
        <div><h1>Faturados</h1><p className="mut">Uma fatura por cliente e período, com PDF, QR Code PIX e baixa total ou parcial.</p></div>
        <div className="linha">{eu.permissoes.includes('receber.ver') && <Botao variante="sec" onClick={() => setCobranca(true)}>Cobrança por e-mail</Botao>}{eu.permissoes.includes('fatura.gerar') && <Botao onClick={() => setGerar(true)}>Gerar faturas</Botao>}</div>
      </div>
      <form className="cartao" onSubmit={(e) => { e.preventDefault(); setAplicado(f); }}>
        <div className="linha">
          <Selecao rotulo="Situação" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value as Sit })}>{(Object.keys(SITUACAO) as Sit[]).map((k) => <option key={k} value={k}>{SITUACAO[k]}</option>)}</Selecao>
          <Selecao rotulo="Cliente" value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })}><option value="">Todos</option>{clientes.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
          <Campo rotulo="Emitidas de" type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} />
          <Campo rotulo="até" type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} />
          <Botao type="submit">Filtrar</Botao>
        </div>
      </form>
      <div className="cartao pilha">
        {lista.data && <span className="mut">{plural(lista.data.total, 'fatura', 'faturas')} · saldo em aberto nesta lista: {formatarBRL(saldo)}</span>}
        {lista.isLoading ? <Carregando /> : lista.isError ? <Aviso tipo="erro">{mensagemDoErro(lista.error)}</Aviso> : (
          <div className="tw"><table>
            <thead><tr><th>Nº</th><th>Cliente</th><th>Período</th><th>Emissão</th><th>Vencimento</th><th className="num">Valor</th><th className="num">Saldo</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td><button type="button" onClick={() => setSel(i.id)} style={{ background: 'none', border: 0, color: 'var(--verde)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>{i.numero}</button></td>
                  <td>{i.cliente}</td><td>{dataBr(i.periodoIni)} a {dataBr(i.periodoFim)}</td><td>{dataBr(i.emissao)}</td><td>{dataBr(i.vencimento)}</td>
                  <td className="num">{formatarBRL(i.totalCentavos)}</td><td className="num">{i.status === 'CANCELADA' ? '—' : formatarBRL(i.saldoCentavos)}</td><td>{pilula(i)}</td>
                  <td><a className="btn sec peq" href={`${API_BASE}/faturas/${i.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></td>
                </tr>
              ))}
              {itens.length === 0 && <tr><td colSpan={9} className="vazio">Nenhuma fatura com estes filtros.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      <Detalhe id={sel} eu={eu} onFechar={() => setSel(null)} />
      <Cobranca aberto={cobranca} eu={eu} onFechar={() => setCobranca(false)} />
      <Gerar aberto={gerar} onFechar={() => setGerar(false)} onVer={(id) => { setGerar(false); setSel(id); }} />
    </div>
  );
}

function Gerar({ aberto, onFechar, onVer }: { aberto: boolean; onFechar: () => void; onVer: (id: string) => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [p, setP] = useState(() => periodoSugerido('MENSAL', hojeIso()));
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<{ clienteId: string; ok: boolean; fatura?: { id: string; numero: number }; erro?: string }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const previa = useQuery({ queryKey: ['faturas', 'previa', p.ini, p.fim], enabled: aberto && p.fim >= p.ini, queryFn: () => api.get<{ clientes: PreviaCliente[] }>(`/faturas/previa?periodoIni=${p.ini}&periodoFim=${p.fim}`) });
  const clientes = previa.data?.clientes ?? [];
  const gerar = useMutation({
    mutationFn: () => api.post<{ geradas: number; erros: number; resultados: { clienteId: string; ok: boolean; fatura?: { id: string; numero: number }; erro?: string }[] }>('/faturas', { periodoIni: p.ini, periodoFim: p.fim, clienteIds: [...escolhidos] }),
    onSuccess: (r) => { setRes(r.resultados); setErro(null); qc.invalidateQueries({ queryKey: ['faturas'] }); qc.invalidateQueries({ queryKey: ['receber'] }); avisar(r.erros ? `${plural(r.geradas, 'fatura gerada', 'faturas geradas')}, ${r.erros} com problema.` : `${plural(r.geradas, 'fatura gerada', 'faturas geradas')}.`); setEscolhidos(new Set()); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const alternar = (id: string) => setEscolhidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Gerar faturas">
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="linha">
          {(['SEMANAL', 'QUINZENAL', 'MENSAL'] as const).map((k) => <Botao key={k} variante="sec" pequeno onClick={() => { setP(periodoSugerido(k, hojeIso())); setRes(null); }}>{PERIODICIDADE[k]}: último período</Botao>)}
        </div>
        <div className="linha">
          <Campo rotulo="De" type="date" max={hojeIso()} value={p.ini} onChange={(e) => { setP({ ...p, ini: e.target.value }); setRes(null); }} />
          <Campo rotulo="Até" type="date" max={hojeIso()} value={p.fim} onChange={(e) => { setP({ ...p, fim: e.target.value }); setRes(null); }} />
        </div>
        <p className="mut peq">Só entram laudos de formas faturadas, ainda em aberto e fora de outra fatura. A fatura vence na emissão + o prazo de cada cliente.</p>
        {previa.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th><input type="checkbox" aria-label="Selecionar todos" checked={clientes.length > 0 && escolhidos.size === clientes.length} onChange={(e) => setEscolhidos(e.target.checked ? new Set(clientes.map((c) => c.clienteId)) : new Set())} /></th><th>Cliente</th><th>Cobrança</th><th className="num">Laudos</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.clienteId}><td><input type="checkbox" aria-label={`Selecionar ${c.cliente}`} checked={escolhidos.has(c.clienteId)} onChange={() => alternar(c.clienteId)} /></td>
                  <td>{c.cliente}</td><td>{PERIODICIDADE[c.periodicidade]} · {c.prazoDias} dias</td><td className="num">{c.titulos}</td><td className="num">{formatarBRL(c.totalCentavos)}</td></tr>
              ))}
              {clientes.length === 0 && <tr><td colSpan={5} className="vazio">Nenhum cliente com laudos para faturar neste período.</td></tr>}
            </tbody>
          </table></div>
        )}
        {res && res.map((r) => (
          <div key={r.clienteId} className="linha" style={{ alignItems: 'center' }}>
            {r.ok ? <Pilula tipo="ok">✓ Gerada</Pilula> : <Pilula tipo="erro">✕ Não gerada</Pilula>}
            <span>{r.ok ? `Fatura nº ${r.fatura!.numero}` : r.erro}</span>{r.ok && <Botao variante="sec" pequeno onClick={() => onVer(r.fatura!.id)}>Abrir</Botao>}
          </div>
        ))}
        <Botao carregando={gerar.isPending} disabled={escolhidos.size === 0} onClick={() => gerar.mutate()}>Gerar {escolhidos.size ? plural(escolhidos.size, 'fatura', 'faturas') : 'faturas'}</Botao>
      </div>
    </Dialogo>
  );
}

function Detalhe({ id, eu, onFechar }: { id: string | null; eu: Eu; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const d = useQuery({ queryKey: ['faturas', 'detalhe', id], enabled: !!id, queryFn: () => api.get<FaturaDetalhe>(`/faturas/${id}`) });
  const pix = useQuery({ queryKey: ['faturas', 'pix', id], enabled: !!id && (d.data?.status === 'ABERTA' || d.data?.status === 'PARCIAL'), queryFn: () => api.get<PixFatura>(`/faturas/${id}/pix`) });
  const contas = useQuery({ queryKey: ['caixa', 'contas-sel'], enabled: !!id, queryFn: () => api.get<{ contas: ContaCaixa[] }>('/caixa/contas') });
  const formas = useQuery({ queryKey: ['formas'], enabled: !!id, queryFn: () => api.get<FormaPagamento[]>('/formas-pagamento') });
  const [modo, setModo] = useState<null | 'baixar' | 'cancelar' | 'refs'>(null);
  const [f, setF] = useState({ data: hojeIso(), principal: null as number | null, conta: '', forma: '', perdoar: false, motivo: '', nf: '', boleto: '' });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const t = d.data;
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['faturas'] }); qc.invalidateQueries({ queryKey: ['receber'] }); qc.invalidateQueries({ queryKey: ['caixa'] }); qc.invalidateQueries({ queryKey: ['laudos'] }); };
  const fechar = () => { setModo(null); setErro(null); setCampos({}); onFechar(); };
  const ok = (msg: string) => () => { avisar(msg); recarregar(); setModo(null); setErro(null); setCampos({}); };
  const falha = (e: unknown) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); };
  const baixar = useMutation({ mutationFn: () => api.post(`/faturas/${id}/baixas`, { data: f.data, principalCentavos: f.principal ?? undefined, contaId: f.conta || undefined, formaPagamentoId: f.forma || undefined, perdoarEncargos: f.perdoar || undefined, motivo: f.motivo || undefined }), onSuccess: ok('Recebimento registrado.'), onError: falha });
  const cancelar = useMutation({ mutationFn: () => api.post(`/faturas/${id}/cancelar`, { motivo: f.motivo }), onSuccess: ok('Fatura cancelada.'), onError: falha });
  const enviarEmail = useMutation({ mutationFn: () => api.post<{ status: string; erro?: string | null }>(`/faturas/${id}/enviar-email`, {}), onSuccess: (r) => { if (r.status === 'ENVIADO') avisar('Fatura enviada por e-mail.'); else setErro(r.erro ?? 'O e-mail não foi enviado.'); recarregar(); }, onError: falha });
  const refs = useMutation({ mutationFn: () => api.patch(`/faturas/${id}`, { numeroNf: f.nf.trim() || null, numeroBoleto: f.boleto.trim() || null }), onSuccess: ok('Referências salvas.'), onError: falha });
  const aberta = t && (t.status === 'ABERTA' || t.status === 'PARCIAL');
  const copiar = async () => { try { await navigator.clipboard.writeText(pix.data!.copiaECola!); avisar('Código PIX copiado.'); } catch { avisar('Selecione o código e copie com Ctrl+C.', 'erro'); } };
  return (
    <Dialogo aberto={!!id} onFechar={fechar} titulo={t ? `Fatura nº ${t.numero} · ${t.cliente}` : 'Fatura'} lateral>
      {!t ? <Carregando /> : (
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="linha">{pilula(t)}<a className="btn sec peq" href={`${API_BASE}/faturas/${t.id}/pdf`} target="_blank" rel="noreferrer">Abrir PDF</a></div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
            {([['Período', `${dataBr(t.periodoIni)} a ${dataBr(t.periodoFim)}`], ['Emissão', dataBr(t.emissao)], ['Vencimento', dataBr(t.vencimento)], ['Valor da fatura', formatarBRL(t.totalCentavos)], ['Já recebido', formatarBRL(t.recebidoCentavos)], ['Saldo', formatarBRL(t.saldoCentavos)], ['NF (referência)', t.numeroNf ?? '—'], ['Boleto (referência)', t.numeroBoleto ?? '—']] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt className="mut">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>
            ))}
          </dl>
          {aberta && t.encargosCentavos > 0 && <Aviso tipo="aviso">Vencida há {t.diasAtraso} dias: multa e juros de hoje somam {formatarBRL(t.encargosCentavos)}. Total a pagar hoje: {formatarBRL(t.totalHojeCentavos)}.</Aviso>}
          {t.status === 'CANCELADA' && <Aviso tipo="info">Cancelada: {t.motivoCancelamento}</Aviso>}
          {aberta && pix.data && (
            <div className="cartao pilha" style={{ background: 'var(--suave)' }}>
              <h3>Como pagar</h3>
              {pix.data.disponivel ? (
                <div className="linha" style={{ alignItems: 'flex-start' }}>
                  <img className="qr" src={pix.data.qrCode} alt="QR Code PIX da fatura" />
                  <div className="pilha" style={{ flex: 1, minWidth: 200, gap: 8 }}>
                    <span>PIX de <b>{formatarBRL(pix.data.valorCentavos)}</b> para {pix.data.titular}.</span>
                    <textarea readOnly aria-label="PIX copia e cola" value={pix.data.copiaECola} rows={4} style={{ fontFamily: 'monospace', fontSize: 11, width: '100%' }} onFocus={(e) => e.target.select()} />
                    <Botao variante="sec" pequeno onClick={copiar}>Copiar código PIX</Botao>
                    <span className="peq mut">O QR Code vale o saldo de hoje, com multa e juros. A baixa é manual, depois que o dinheiro entrar.</span>
                  </div>
                </div>
              ) : <Aviso tipo="info">Nenhuma conta com chave PIX está marcada para aparecer na fatura. Marque em Cadastros › Contas bancárias (o Administrativo confirma com senha).</Aviso>}
            </div>
          )}
          <h3>Laudos da fatura</h3>
          <div className="tw"><table>
            <thead><tr><th>Data</th><th>Placa</th><th>Serviço</th><th className="num">Valor</th><th className="num">Saldo</th></tr></thead>
            <tbody>{t.titulos.map((x) => <tr key={x.id}><td>{dataBr(x.dataLaudo)}</td><td><b>{x.placa}</b></td><td>{x.servico}</td><td className="num">{formatarBRL(x.valorCentavos)}</td><td className="num">{x.status === 'QUITADO' ? '✓' : formatarBRL(x.saldoCentavos)}</td></tr>)}</tbody>
          </table></div>
          {modo === null && (
            <div className="linha">
              {aberta && eu.permissoes.includes('receber.baixar') && <Botao onClick={() => { setModo('baixar'); setF({ ...f, data: hojeIso(), principal: null, motivo: '', perdoar: false }); }}>Registrar recebimento</Botao>}
              {t.status !== 'CANCELADA' && eu.permissoes.includes('fatura.gerar') && <Botao variante="sec" onClick={() => { setModo('refs'); setF({ ...f, nf: t.numeroNf ?? '', boleto: t.numeroBoleto ?? '' }); }}>NF e boleto</Botao>}
              {aberta && eu.permissoes.includes('fatura.gerar') && <Botao variante="sec" carregando={enviarEmail.isPending} onClick={() => enviarEmail.mutate()}>Enviar por e-mail</Botao>}
              {aberta && eu.permissoes.includes('fatura.cancelar') && <Botao variante="perigo" onClick={() => { setModo('cancelar'); setF({ ...f, motivo: '' }); }}>Cancelar fatura</Botao>}
            </div>
          )}
          {modo === 'baixar' && (
            <div className="cartao pilha" style={{ background: 'var(--suave)' }}>
              <h3>Registrar recebimento</h3>
              <div className="linha">
                <Campo rotulo="Data do recebimento" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} erro={campos.data} />
                <CampoDinheiro rotulo="Valor da fatura a baixar (R$)" centavos={f.principal} onChange={(v) => setF({ ...f, principal: v })} erro={campos.principalCentavos} dica={`Vazio quita tudo (${formatarBRL(t.saldoCentavos)} + encargos).`} />
              </div>
              <div className="linha">
                <Selecao rotulo="Conta em que entrou" obrigatorio value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })} erro={campos.contaId}><option value="">Escolha…</option>{contas.data?.contas.filter((c) => c.status === 'ATIVO').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
                <Selecao rotulo="Forma de pagamento" value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value })}><option value="">Como nos laudos</option>{formas.data?.filter((x) => x.status !== 'INATIVO').map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
              </div>
              {t.encargosCentavos > 0 && <label className="check"><input type="checkbox" checked={f.perdoar} onChange={(e) => setF({ ...f, perdoar: e.target.checked })} />Perdoar multa e juros</label>}
              {f.perdoar && <Campo rotulo="Motivo do perdão" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} erro={campos.motivo} />}
              <div className="linha"><Botao carregando={baixar.isPending} onClick={() => baixar.mutate()}>Confirmar recebimento</Botao><Botao variante="sec" onClick={() => { setModo(null); setErro(null); }}>Voltar</Botao></div>
            </div>
          )}
          {modo === 'refs' && (
            <div className="pilha">
              <p className="mut peq">Só referência: o sistema não emite nota fiscal nem boleto. Guarde aqui os números emitidos fora.</p>
              <Campo rotulo="Número da NF" value={f.nf} onChange={(e) => setF({ ...f, nf: e.target.value })} />
              <Campo rotulo="Número do boleto" value={f.boleto} onChange={(e) => setF({ ...f, boleto: e.target.value })} />
              <div className="linha"><Botao carregando={refs.isPending} onClick={() => refs.mutate()}>Salvar</Botao><Botao variante="sec" onClick={() => setModo(null)}>Voltar</Botao></div>
            </div>
          )}
          {modo === 'cancelar' && (
            <div className="pilha">
              <p className="mut">Os laudos voltam a ficar em aberto, sem fatura, e podem entrar numa nova. Só dá para cancelar se nada foi recebido.</p>
              <Campo rotulo="Motivo" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
              <div className="linha"><Botao variante="perigo" carregando={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar fatura</Botao><Botao variante="sec" onClick={() => { setModo(null); setErro(null); }}>Voltar</Botao></div>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  );
}

const ROTULO_STATUS_EMAIL: Record<string, string> = { ENVIADO: 'Enviado', ERRO: 'Erro no envio', SEM_CONFIGURACAO: 'E-mail não configurado', SEM_DESTINATARIO: 'Sem e-mail do cliente', PENDENTE: 'Pendente' };
const ROTULO_TIPO_EMAIL: Record<string, string> = { FATURA: 'Fatura nova', LEMBRETE: 'Lembrete', ATRASO: 'Aviso de atraso', MANUAL: 'Envio manual' };

function Cobranca({ aberto, eu, onFechar }: { aberto: boolean; eu: Eu; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const regua = useQuery({ queryKey: ['cobranca', 'regua', eu.empresaAtivaId], enabled: aberto, queryFn: () => api.get<{ ativa: boolean; enviarAoGerar: boolean; diasAntes: number[]; diasApos: number[]; copiaPara: string | null; smtpConfigurado: boolean }>('/cobranca/regua') });
  const envios = useQuery({ queryKey: ['cobranca', 'envios', eu.empresaAtivaId], enabled: aberto, queryFn: () => api.get<{ id: string; fatura: number; cliente: string; tipo: string; status: string; erro: string | null; criadoEm: string; para: string[] }[]>('/cobranca/envios') });
  const [f, setF] = useState<{ ativa: boolean; enviarAoGerar: boolean; antes: string; apos: string; copia: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (regua.data && !f) setF({ ativa: regua.data.ativa, enviarAoGerar: regua.data.enviarAoGerar, antes: regua.data.diasAntes.join(', '), apos: regua.data.diasApos.join(', '), copia: regua.data.copiaPara ?? '' });
  const lista = (t: string) => t.split(/[,;\s]+/).filter(Boolean).map(Number);
  const salvar = useMutation({
    mutationFn: () => api.put('/cobranca/regua', { ativa: f!.ativa, enviarAoGerar: f!.enviarAoGerar, diasAntes: lista(f!.antes), diasApos: lista(f!.apos), copiaPara: f!.copia || null }),
    onSuccess: () => { avisar('Régua de cobrança salva.'); setErro(null); qc.invalidateQueries({ queryKey: ['cobranca'] }); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const agora = useMutation({
    mutationFn: () => api.post<{ ativa: boolean; enviados: number; semConfiguracao: number; semDestinatario: number; erros: number }>('/cobranca/processar'),
    onSuccess: (r) => { avisar(!r.ativa ? 'A régua está desligada.' : `${r.enviados} e-mails enviados${r.erros || r.semConfiguracao || r.semDestinatario ? `, ${r.erros + r.semConfiguracao + r.semDestinatario} com problema (veja o histórico)` : ''}.`); qc.invalidateQueries({ queryKey: ['cobranca'] }); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const pode = eu.permissoes.includes('regua_cobranca.editar');
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Cobrança por e-mail" lateral>
      {!f ? <Carregando /> : (
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {regua.data && !regua.data.smtpConfigurado && <Aviso tipo="aviso">O envio de e-mail ainda não está configurado neste ambiente. As cobranças ficam registradas como "e-mail não configurado" e nada sai até a equipe técnica configurar o servidor de e-mail.</Aviso>}
          <label className="check"><input type="checkbox" disabled={!pode} checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />Régua de cobrança ligada (todo dia pela manhã)</label>
          <label className="check"><input type="checkbox" disabled={!pode} checked={f.enviarAoGerar} onChange={(e) => setF({ ...f, enviarAoGerar: e.target.checked })} />Enviar a fatura por e-mail assim que ela for gerada</label>
          <Campo rotulo="Lembrar quantos dias antes do vencimento" disabled={!pode} value={f.antes} onChange={(e) => setF({ ...f, antes: e.target.value })} dica="Ex.: 3, 1. Até 5 prazos." />
          <Campo rotulo="Avisar quantos dias depois do vencimento" disabled={!pode} value={f.apos} onChange={(e) => setF({ ...f, apos: e.target.value })} dica="Ex.: 1, 7, 15. Cada aviso sai uma única vez por fatura." />
          <Campo rotulo="Mandar cópia para (opcional)" disabled={!pode} value={f.copia} onChange={(e) => setF({ ...f, copia: e.target.value })} />
          {pode && <div className="linha"><Botao carregando={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Botao><Botao variante="sec" carregando={agora.isPending} onClick={() => agora.mutate()}>Enviar as cobranças de hoje agora</Botao></div>}
          <h3>Histórico de envios</h3>
          <div className="tw"><table>
            <thead><tr><th>Quando</th><th>Fatura</th><th>Tipo</th><th>Situação</th></tr></thead>
            <tbody>
              {envios.data?.map((e) => <tr key={e.id}><td>{new Date(e.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{e.fatura}<div className="peq mut">{e.cliente}</div></td><td>{ROTULO_TIPO_EMAIL[e.tipo]}</td>
                <td>{e.status === 'ENVIADO' ? <Pilula tipo="ok">✓ {ROTULO_STATUS_EMAIL[e.status]}</Pilula> : <Pilula tipo={e.status === 'ERRO' ? 'erro' : 'aviso'}>{ROTULO_STATUS_EMAIL[e.status]}</Pilula>}{e.erro && <div className="peq mut">{e.erro}</div>}</td></tr>)}
              {envios.data?.length === 0 && <tr><td colSpan={4} className="vazio">Nenhum e-mail de cobrança ainda.</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}
    </Dialogo>
  );
}
