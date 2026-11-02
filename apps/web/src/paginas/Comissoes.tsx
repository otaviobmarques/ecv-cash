import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { CampoDinheiro, CampoPercentual, dataBr, hojeIso, mensagemDoErro, pct } from '../formulario';
import type { ApuracaoComissao, Eu, FechamentoComissao, RegraComissao, Servico, VistoriadorItem } from '../tipos';

export function Comissoes() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const [aba, setAba] = useState<'apuracao' | 'regras' | 'fechamentos'>('apuracao');
  if (!eu.empresaAtivaId) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Comissões</h1><p className="mut">A comissão do vistoriador é calculada no lançamento do laudo e fica gravada. No fechamento do período, vira uma conta a pagar.</p></div></div>
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)' }}>
        {([['apuracao', 'Apurar e fechar'], ['fechamentos', 'Fechamentos'], ['regras', 'Regras']] as const).map(([id, r]) => <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: aba === id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${aba === id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{r}</button>)}
      </div>
      {aba === 'apuracao' && <Apuracao eu={eu} />}{aba === 'fechamentos' && <Fechamentos eu={eu} />}{aba === 'regras' && <Regras eu={eu} />}
    </div>
  );
}

function Apuracao({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [p, setP] = useState(() => { const h = hojeIso(); return { de: h.slice(0, 8) + '01', ate: h }; });
  const lista = useQuery({ queryKey: ['comissoes', 'apuracao', eu.empresaAtivaId, p.de, p.ate], enabled: p.ate >= p.de, queryFn: () => api.get<ApuracaoComissao[]>(`/comissoes/apuracao?de=${p.de}&ate=${p.ate}`) });
  const [erro, setErro] = useState<string | null>(null);
  const fechar = useMutation({
    mutationFn: () => api.post<{ fechamentos: number }>('/comissoes/fechar', p),
    onSuccess: (r) => { avisar(r.fechamentos ? `${r.fechamentos} contas a pagar criadas.` : 'Nada a fechar neste período.'); setErro(null); qc.invalidateQueries({ queryKey: ['comissoes'] }); qc.invalidateQueries({ queryKey: ['pagar'] }); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const total = lista.data?.reduce((s, x) => s + x.totalCentavos, 0) ?? 0;
  return (
    <div className="cartao pilha">
      <div className="linha"><Campo rotulo="Laudos de" type="date" value={p.de} onChange={(e) => setP({ ...p, de: e.target.value })} /><Campo rotulo="até" type="date" max={hojeIso()} value={p.ate} onChange={(e) => setP({ ...p, ate: e.target.value })} /></div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Vistoriador</th><th className="num">Laudos prontos</th><th className="num">Comissão a fechar</th><th className="num">Aguardando recebimento</th></tr></thead>
          <tbody>
            {lista.data?.map((g) => <tr key={g.vistoriadorId}><td><b>{g.vistoriador}</b></td><td className="num">{g.laudos}</td><td className="num">{formatarBRL(g.totalCentavos)}</td><td className="num">{g.aguardandoLaudos ? `${formatarBRL(g.aguardandoCentavos)} (${g.aguardandoLaudos} laudos)` : '—'}</td></tr>)}
            {lista.data?.length === 0 && <tr><td colSpan={4} className="vazio">Nenhuma comissão em aberto neste período. Cadastre as regras na aba Regras.</td></tr>}
          </tbody>
        </table></div>
      )}
      {eu.permissoes.includes('comissao.fechar') && <Botao disabled={total === 0} carregando={fechar.isPending} onClick={() => fechar.mutate()}>Fechar e gerar contas a pagar ({formatarBRL(total)})</Botao>}
      <p className="mut peq">Comissão "devida no recebimento" só entra depois que o cliente paga o laudo.</p>
    </div>
  );
}

function Fechamentos({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['comissoes', 'fechamentos', eu.empresaAtivaId], queryFn: () => api.get<FechamentoComissao[]>('/comissoes/fechamentos') });
  const [alvo, setAlvo] = useState<FechamentoComissao | null>(null); const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post(`/comissoes/fechamentos/${alvo!.id}/cancelar`, { motivo }),
    onSuccess: () => { avisar('Fechamento cancelado.'); setAlvo(null); setMotivo(''); setErro(null); qc.invalidateQueries({ queryKey: ['comissoes'] }); qc.invalidateQueries({ queryKey: ['pagar'] }); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  return (
    <div className="cartao pilha">
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Vistoriador</th><th>Período</th><th className="num">Laudos</th><th className="num">Total</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((f) => <tr key={f.id}><td>{f.vistoriador}</td><td>{dataBr(f.periodoIni)} a {dataBr(f.periodoFim)}</td><td className="num">{f.laudos}</td><td className="num">{formatarBRL(f.totalCentavos)}</td>
              <td>{f.status === 'CANCELADO' ? <Pilula>Cancelado</Pilula> : <Pilula tipo="ok">✓ Fechado</Pilula>}{f.statusPagar && f.status === 'FECHADO' && <div className="peq mut">Conta a pagar: {f.statusPagar.toLowerCase()}</div>}{f.motivoCancelamento && <div className="peq mut">{f.motivoCancelamento}</div>}</td>
              <td>{f.status === 'FECHADO' && eu.permissoes.includes('comissao.fechar') && <Botao variante="sec" pequeno onClick={() => { setAlvo(f); setErro(null); }}>Cancelar</Botao>}</td></tr>)}
            {lista.data?.length === 0 && <tr><td colSpan={6} className="vazio">Nenhum fechamento ainda.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Dialogo aberto={!!alvo} onFechar={() => setAlvo(null)} titulo="Cancelar fechamento">
        <div className="pilha">{erro && <Aviso tipo="erro">{erro}</Aviso>}<p className="mut">A conta a pagar é cancelada e os laudos voltam para a apuração. Não dá se a conta já recebeu pagamento.</p>
          <Campo rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} /><Botao variante="perigo" carregando={m.isPending} onClick={() => m.mutate()}>Cancelar fechamento</Botao></div>
      </Dialogo>
    </div>
  );
}

function Regras({ eu }: { eu: Eu }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['comissoes', 'regras', eu.empresaAtivaId], queryFn: () => api.get<RegraComissao[]>('/comissoes/regras') });
  const vists = useQuery({ queryKey: ['vistoriadores'], queryFn: () => api.get<VistoriadorItem[]>('/vistoriadores') });
  const servs = useQuery({ queryKey: ['servicos'], queryFn: () => api.get<Servico[]>('/servicos') });
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ vistoriadorId: '', servicoId: '', tipo: 'PERCENTUAL' as 'PERCENTUAL' | 'VALOR', bp: null as number | null, valor: null as number | null, devidaEm: 'EMISSAO', ini: hojeIso(), fim: '' });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const criar = useMutation({
    mutationFn: () => api.post('/comissoes/regras', { vistoriadorId: f.vistoriadorId || undefined, servicoId: f.servicoId || undefined, tipo: f.tipo, percentualBp: f.tipo === 'PERCENTUAL' ? f.bp ?? undefined : undefined, valorCentavos: f.tipo === 'VALOR' ? f.valor ?? undefined : undefined, devidaEm: f.devidaEm, vigenciaIni: f.ini, vigenciaFim: f.fim || undefined }),
    onSuccess: () => { avisar('Regra criada. Vale para os próximos laudos.'); setAberto(false); setErro(null); qc.invalidateQueries({ queryKey: ['comissoes'] }); },
    onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  const desativar = useMutation({ mutationFn: (v: { id: string; ativa: boolean }) => api.patch(`/comissoes/regras/${v.id}`, { ativa: v.ativa }), onSuccess: () => qc.invalidateQueries({ queryKey: ['comissoes'] }) });
  return (
    <div className="cartao pilha">
      <div className="linha entre"><p className="mut">Vale a regra mais específica: vistoriador e serviço, depois só vistoriador, só serviço, e por fim a geral. Mudar uma regra não altera laudos já lançados.</p>{eu.permissoes.includes('comissao_regra.editar') && <Botao onClick={() => { setAberto(true); setErro(null); setCampos({}); }}>Nova regra</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Quem</th><th>Serviço</th><th>Comissão</th><th>Devida</th><th>Vigência</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((r) => <tr key={r.id}><td>{r.vistoriador ?? 'Todos'}</td><td>{r.servico ?? 'Todos'}</td><td>{r.tipo === 'PERCENTUAL' ? `${pct(r.percentualBp)} do valor` : `${formatarBRL(r.valorCentavos ?? 0)} por laudo`}</td><td>{r.devidaEm === 'EMISSAO' ? 'Na emissão' : 'No recebimento'}</td><td>{dataBr(r.vigenciaIni)}{r.vigenciaFim ? ` a ${dataBr(r.vigenciaFim)}` : ' em diante'}</td>
              <td>{r.ativa ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td><td>{eu.permissoes.includes('comissao_regra.editar') && <Botao variante="sec" pequeno onClick={() => desativar.mutate({ id: r.id, ativa: !r.ativa })}>{r.ativa ? 'Desativar' : 'Reativar'}</Botao>}</td></tr>)}
            {lista.data?.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma regra. Sem regra, os laudos não geram comissão.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Dialogo aberto={aberto} onFechar={() => setAberto(false)} titulo="Nova regra de comissão">
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Selecao rotulo="Vistoriador" value={f.vistoriadorId} onChange={(e) => setF({ ...f, vistoriadorId: e.target.value })} erro={campos.vistoriadorId}><option value="">Todos</option>{vists.data?.filter((v) => v.status === 'ATIVO' && v.empresaIds.includes(eu.empresaAtivaId!)).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}</Selecao>
          <Selecao rotulo="Serviço" value={f.servicoId} onChange={(e) => setF({ ...f, servicoId: e.target.value })}><option value="">Todos</option>{servs.data?.filter((s) => s.status !== 'INATIVO').map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</Selecao>
          <div className="linha">
            <Selecao rotulo="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as 'PERCENTUAL' | 'VALOR' })}><option value="PERCENTUAL">Percentual do valor cobrado</option><option value="VALOR">Valor fixo por laudo</option></Selecao>
            {f.tipo === 'PERCENTUAL' ? <CampoPercentual rotulo="Percentual (%)" obrigatorio bp={f.bp} onChange={(b) => setF({ ...f, bp: b })} erro={campos.percentualBp} /> : <CampoDinheiro rotulo="Valor por laudo (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorCentavos} />}
          </div>
          <Selecao rotulo="Devida" value={f.devidaEm} onChange={(e) => setF({ ...f, devidaEm: e.target.value })}><option value="EMISSAO">Na emissão do laudo</option><option value="RECEBIMENTO">Só quando o cliente pagar</option></Selecao>
          <div className="linha"><Campo rotulo="Vale desde" type="date" value={f.ini} onChange={(e) => setF({ ...f, ini: e.target.value })} erro={campos.vigenciaIni} /><Campo rotulo="Até (opcional)" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} erro={campos.vigenciaFim} /></div>
          <Botao carregando={criar.isPending} onClick={() => criar.mutate()}>Criar regra</Botao>
        </div>
      </Dialogo>
    </div>
  );
}
