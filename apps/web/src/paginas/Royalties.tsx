import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { CampoDinheiro, CampoPercentual, dataBr, hojeIso, mensagemDoErro, pct } from '../formulario';
import type { ApuracaoRepasse, Eu, Fornecedor, PreviaRepasse, RegraRepasse } from '../tipos';

const BASE = { BRUTO: 'faturamento bruto', LIQUIDO: 'faturamento líquido (menos custos e impostos)', RECEBIDO: 'valor recebido' } as const;
const mesPassado = () => { const [a, m] = hojeIso().split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7); };

export function Royalties() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const [aba, setAba] = useState<'apurar' | 'regras' | 'historico'>('apurar');
  if (!eu.empresaAtivaId) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Royalties e taxas da franquia</h1><p className="mut">Regras por loja, apuração mensal e a conta a pagar gerada para o franqueador.</p></div></div>
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)' }}>
        {([['apurar', 'Apurar o mês'], ['historico', 'Apurações'], ['regras', 'Regras']] as const).map(([id, r]) => <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: aba === id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${aba === id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{r}</button>)}
      </div>
      {aba === 'apurar' && <Apurar eu={eu} />}{aba === 'historico' && <Historico eu={eu} />}{aba === 'regras' && <Regras eu={eu} />}
    </div>
  );
}

function Apurar({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [mes, setMes] = useState(mesPassado());
  const prev = useQuery({ queryKey: ['repasses', 'previa', eu.empresaAtivaId, mes], enabled: /^\d{4}-\d{2}$/.test(mes), queryFn: () => api.get<PreviaRepasse[]>(`/repasses/previa?mes=${mes}`) });
  const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ apuradas: number; pulados: { nome: string; motivo: string }[] }>('/repasses/apurar', { mes }),
    onSuccess: (r) => { avisar(`${r.apuradas} contas a pagar criadas.`); setErro(r.pulados.map((p) => `${p.nome}: ${p.motivo}`).join(' · ') || null); qc.invalidateQueries({ queryKey: ['repasses'] }); qc.invalidateQueries({ queryKey: ['pagar'] }); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const total = prev.data?.filter((x) => !x.apurada).reduce((s, x) => s + x.valorCentavos, 0) ?? 0;
  return (
    <div className="cartao pilha">
      <Campo rotulo="Mês" type="month" max={mesPassado()} value={mes} onChange={(e) => setMes(e.target.value)} />
      {erro && <Aviso tipo="info">{erro}</Aviso>}
      {prev.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Regra</th><th>Favorecido</th><th className="num">Base</th><th className="num">Valor</th><th>Situação</th></tr></thead>
          <tbody>
            {prev.data?.map((p) => <tr key={p.regraId}><td><b>{p.nome}</b>{p.baseTipo && <div className="peq mut">sobre o {BASE[p.baseTipo as keyof typeof BASE]}</div>}</td><td>{p.fornecedor}</td><td className="num">{p.tipo === 'PERCENTUAL' ? formatarBRL(p.baseCentavos) : '—'}</td><td className="num">{formatarBRL(p.valorCentavos)}</td><td>{p.apurada ? <Pilula tipo="ok">✓ Apurado</Pilula> : p.valorCentavos > 0 ? <Pilula tipo="neutra">A apurar</Pilula> : <Pilula>Sem valor</Pilula>}</td></tr>)}
            {prev.data?.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma regra vale neste mês. Cadastre na aba Regras.</td></tr>}
          </tbody>
        </table></div>
      )}
      {eu.permissoes.includes('repasse.apurar') ? <Botao disabled={total === 0} carregando={m.isPending} onClick={() => m.mutate()}>Apurar e gerar contas a pagar ({formatarBRL(total)})</Botao> : <span className="mut peq">Só o Administrativo apura.</span>}
    </div>
  );
}

function Historico({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['repasses', 'apuracoes', eu.empresaAtivaId], queryFn: () => api.get<ApuracaoRepasse[]>('/repasses/apuracoes') });
  const [alvo, setAlvo] = useState<ApuracaoRepasse | null>(null); const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api.post(`/repasses/apuracoes/${alvo!.id}/cancelar`, { motivo }), onSuccess: () => { avisar('Apuração cancelada.'); setAlvo(null); setMotivo(''); setErro(null); qc.invalidateQueries({ queryKey: ['repasses'] }); qc.invalidateQueries({ queryKey: ['pagar'] }); }, onError: (e) => setErro(mensagemDoErro(e)) });
  return (
    <div className="cartao pilha">
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Mês</th><th>Regra</th><th>Favorecido</th><th className="num">Base</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((p) => <tr key={p.id}><td>{p.mes.split('-').reverse().join('/')}</td><td>{p.nome}</td><td>{p.fornecedor}</td><td className="num">{p.baseCentavos ? formatarBRL(p.baseCentavos) : '—'}</td><td className="num">{formatarBRL(p.valorCentavos)}</td>
              <td>{p.status === 'CANCELADO' ? <Pilula>Cancelada</Pilula> : <Pilula tipo="ok">✓ Apurada</Pilula>}{p.statusPagar && p.status === 'APURADO' && <div className="peq mut">Conta a pagar: {p.statusPagar.toLowerCase()}</div>}{p.motivoCancelamento && <div className="peq mut">{p.motivoCancelamento}</div>}</td>
              <td>{p.status === 'APURADO' && eu.permissoes.includes('repasse.apurar') && <Botao variante="sec" pequeno onClick={() => { setAlvo(p); setErro(null); }}>Cancelar</Botao>}</td></tr>)}
            {lista.data?.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma apuração ainda.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Dialogo aberto={!!alvo} onFechar={() => setAlvo(null)} titulo="Cancelar apuração">
        <div className="pilha">{erro && <Aviso tipo="erro">{erro}</Aviso>}<p className="mut">A conta a pagar é cancelada e o mês pode ser apurado de novo. Não dá se a conta já recebeu pagamento.</p>
          <Campo rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} /><Botao variante="perigo" carregando={m.isPending} onClick={() => m.mutate()}>Cancelar apuração</Botao></div>
      </Dialogo>
    </div>
  );
}

function Regras({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['repasses', 'regras', eu.empresaAtivaId], queryFn: () => api.get<RegraRepasse[]>('/repasses/regras') });
  const forn = useQuery({ queryKey: ['fornecedores'], queryFn: () => api.get<Fornecedor[]>('/fornecedores') });
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ fornecedorId: '', nome: 'Royalties', tipo: 'PERCENTUAL' as 'PERCENTUAL' | 'VALOR_FIXO', bp: null as number | null, valor: null as number | null, base: 'BRUTO', venc: '10', ini: hojeIso(), fim: '' });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const criar = useMutation({
    mutationFn: () => api.post('/repasses/regras', { fornecedorId: f.fornecedorId, nome: f.nome, tipo: f.tipo, percentualBp: f.tipo === 'PERCENTUAL' ? f.bp ?? undefined : undefined, valorCentavos: f.tipo === 'VALOR_FIXO' ? f.valor ?? undefined : undefined, base: f.tipo === 'PERCENTUAL' ? f.base : undefined, vencimentoDia: Number(f.venc), vigenciaIni: f.ini, vigenciaFim: f.fim || undefined }),
    onSuccess: () => { avisar('Regra criada.'); setAberto(false); qc.invalidateQueries({ queryKey: ['repasses'] }); }, onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  const alternar = useMutation({ mutationFn: (v: { id: string; ativa: boolean }) => api.patch(`/repasses/regras/${v.id}`, { ativa: v.ativa }), onSuccess: () => qc.invalidateQueries({ queryKey: ['repasses'] }) });
  return (
    <div className="cartao pilha">
      <div className="linha entre"><p className="mut">Percentual sobre o faturamento (bruto, líquido ou recebido) ou valor fixo por mês, com vigência. Gera conta a pagar para o franqueador.</p>{eu.permissoes.includes('repasse.editar') && <Botao onClick={() => { setAberto(true); setErro(null); setCampos({}); }}>Nova regra</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Regra</th><th>Favorecido</th><th>Cálculo</th><th>Vence</th><th>Vigência</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((r) => <tr key={r.id}><td><b>{r.nome}</b></td><td>{r.fornecedor}</td><td>{r.tipo === 'PERCENTUAL' ? `${pct(r.percentualBp)} do ${BASE[r.base!]}` : `${formatarBRL(r.valorCentavos ?? 0)} por mês`}</td><td>dia {r.vencimentoDia} do mês seguinte</td><td>{dataBr(r.vigenciaIni)}{r.vigenciaFim ? ` a ${dataBr(r.vigenciaFim)}` : ' em diante'}</td><td>{r.ativa ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td>
              <td>{eu.permissoes.includes('repasse.editar') && <Botao variante="sec" pequeno onClick={() => alternar.mutate({ id: r.id, ativa: !r.ativa })}>{r.ativa ? 'Desativar' : 'Reativar'}</Botao>}</td></tr>)}
            {lista.data?.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma regra de royalties nesta loja.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Dialogo aberto={aberto} onFechar={() => setAberto(false)} titulo="Nova regra de royalties">
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Campo rotulo="Nome" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={campos.nome} />
          <Selecao rotulo="Quem recebe" obrigatorio value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })} erro={campos.fornecedorId}><option value="">Escolha…</option>{forn.data?.filter((x) => x.status === 'ATIVO').map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
          <div className="linha">
            <Selecao rotulo="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as 'PERCENTUAL' | 'VALOR_FIXO' })}><option value="PERCENTUAL">Percentual</option><option value="VALOR_FIXO">Valor fixo por mês</option></Selecao>
            {f.tipo === 'PERCENTUAL' ? <CampoPercentual rotulo="Percentual (%)" obrigatorio bp={f.bp} onChange={(b) => setF({ ...f, bp: b })} erro={campos.percentualBp} /> : <CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorCentavos} />}
          </div>
          {f.tipo === 'PERCENTUAL' && <Selecao rotulo="Incide sobre" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} erro={campos.base}>{Object.entries(BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selecao>}
          <Campo rotulo="Dia do vencimento (mês seguinte)" type="number" min={1} max={31} value={f.venc} onChange={(e) => setF({ ...f, venc: e.target.value })} />
          <div className="linha"><Campo rotulo="Vale desde" type="date" value={f.ini} onChange={(e) => setF({ ...f, ini: e.target.value })} erro={campos.vigenciaIni} /><Campo rotulo="Até (opcional)" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} erro={campos.vigenciaFim} /></div>
          <Botao carregando={criar.isPending} onClick={() => criar.mutate()}>Criar regra</Botao>
        </div>
      </Dialogo>
    </div>
  );
}
