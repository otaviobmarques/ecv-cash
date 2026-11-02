import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { CampoDinheiro, dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { ContaCaixa, Eu, Extrato, FechamentoDia, FechamentoMes } from '../tipos';

const ORIGEM: Record<string, string> = { BAIXA_RECEBER: 'Recebimento', PAGAMENTO_PAGAR: 'Pagamento', TRANSFERENCIA: 'Transferência', AJUSTE: 'Ajuste', LIQUIDACAO_CARTAO: 'Cartão', CHEQUE: 'Cheque', SALDO_INICIAL: 'Saldo inicial' };

export function Caixa() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const [aba, setAba] = useState<'extrato' | 'fechamentos'>('extrato');
  const contas = useQuery({ queryKey: ['caixa', 'contas', eu.empresaAtivaId], queryFn: () => api.get<{ hoje: string; contas: ContaCaixa[] }>('/caixa/contas'), enabled: !!eu.empresaAtivaId });
  if (!eu.empresaAtivaId) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Caixa</h1><p className="mut">Contas da loja, extrato, transferências e fechamento do dia e do mês.</p></div></div>
      {contas.isLoading ? <Carregando /> : contas.data && (
        <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {contas.data.contas.map((c) => (
            <div key={c.id} className="cartao pilha" style={{ gap: 6 }}>
              <div className="linha entre"><b>{c.nome}</b>{c.status === 'INATIVO' ? <Pilula>Inativa</Pilula> : <Pilula tipo="neutra">{c.tipo === 'CAIXA' ? 'Caixa' : 'Banco'}</Pilula>}</div>
              <b className="num" style={{ fontSize: 24, textAlign: 'left', color: c.saldoCentavos < 0 ? 'var(--erro)' : undefined }}>{formatarBRL(c.saldoCentavos)}</b>
              <span className="peq mut">{c.fechadoAte ? `Fechado até ${dataBr(c.fechadoAte)}` : 'Nenhum dia fechado ainda'}</span>
            </div>
          ))}
          {contas.data.contas.length === 0 && <Aviso tipo="info">Esta loja ainda não tem conta. Cadastre em Cadastros › Contas bancárias.</Aviso>}
        </div>
      )}
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)' }}>
        {([['extrato', 'Extrato'], ['fechamentos', 'Fechamentos']] as const).map(([id, r]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: aba === id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${aba === id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{r}</button>
        ))}
      </div>
      {contas.data && (aba === 'extrato' ? <ExtratoAba eu={eu} contas={contas.data.contas} /> : <Fechamentos eu={eu} contas={contas.data.contas} />)}
    </div>
  );
}

function ExtratoAba({ eu, contas }: { eu: Eu; contas: ContaCaixa[] }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [contaId, setContaId] = useState(contas[0]?.id ?? '');
  const [de, setDe] = useState(hojeIso().slice(0, 8) + '01'); const [ate, setAte] = useState(hojeIso());
  const [dlg, setDlg] = useState<null | 'ajuste' | 'transferencia'>(null);
  const [estornar, setEstornar] = useState<string | null>(null);
  const extrato = useQuery({ queryKey: ['caixa', 'extrato', contaId, de, ate], enabled: !!contaId, queryFn: () => api.get<Extrato>(`/caixa/extrato?contaId=${contaId}&de=${de}&ate=${ate}`) });
  const recarregar = () => qc.invalidateQueries({ queryKey: ['caixa'] });
  const podeAjustar = eu.permissoes.includes('caixa.ajustar');
  return (
    <div className="pilha">
      <div className="cartao pilha">
        <div className="linha">
          <Selecao rotulo="Conta" value={contaId} onChange={(e) => setContaId(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
          <Campo rotulo="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Campo rotulo="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          <div style={{ flex: 1 }} />
          {podeAjustar && <Botao variante="sec" onClick={() => setDlg('ajuste')}>Novo lançamento</Botao>}
          {eu.permissoes.includes('transferencia.criar') && <Botao onClick={() => setDlg('transferencia')}>Transferir</Botao>}
        </div>
      </div>
      <div className="cartao pilha">
        {extrato.isLoading ? <Carregando /> : extrato.isError ? <Aviso tipo="erro">{mensagemDoErro(extrato.error)}</Aviso> : extrato.data && (
          <>
            <div className="linha" style={{ gap: 24 }}>
              {([['Abertura', extrato.data.aberturaCentavos], ['Entradas', extrato.data.entradasCentavos], ['Saídas', extrato.data.saidasCentavos], ['Saldo no fim', extrato.data.fechoCentavos]] as const).map(([r, v]) => (
                <div key={r}><span className="peq mut">{r}</span><br /><b className="num" style={{ textAlign: 'left' }}>{formatarBRL(v)}</b></div>
              ))}
            </div>
            <div className="tw"><table>
              <thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th className="num">Valor</th><th className="num">Saldo</th><th /></tr></thead>
              <tbody>
                {extrato.data.itens.map((i) => (
                  <tr key={i.id}>
                    <td>{dataBr(i.data)}</td><td>{ORIGEM[i.origem] ?? i.origem}</td>
                    <td>{i.descricao}{i.estornoDe && <> <Pilula tipo="aviso">Estorno</Pilula></>}{i.estornado && <> <Pilula>Estornado</Pilula></>}{i.motivo && <div className="peq mut">{i.motivo}</div>}</td>
                    <td className="num" style={{ color: i.valorCentavos < 0 ? 'var(--erro)' : undefined }}>{formatarBRL(i.valorCentavos)}</td>
                    <td className="num">{formatarBRL(i.saldoCentavos)}</td>
                    <td>{podeAjustar && !i.saldoInicial && !i.estornado && !i.estornoDe && (i.origem === 'AJUSTE' || i.origem === 'TRANSFERENCIA') && <Botao variante="sec" pequeno onClick={() => setEstornar(i.id)}>Estornar</Botao>}</td>
                  </tr>
                ))}
                {extrato.data.itens.length === 0 && <tr><td colSpan={6} className="vazio">Nenhum lançamento neste período.</td></tr>}
              </tbody>
            </table></div>
          </>
        )}
      </div>
      <FormAjuste aberto={dlg === 'ajuste'} contas={contas} contaId={contaId} onFechar={() => setDlg(null)} onOk={() => { recarregar(); avisar('Lançamento registrado.'); setDlg(null); }} />
      <FormTransferencia aberto={dlg === 'transferencia'} contas={contas} contaId={contaId} onFechar={() => setDlg(null)} onOk={() => { recarregar(); avisar('Transferência registrada.'); setDlg(null); }} />
      <FormMotivo aberto={!!estornar} titulo="Estornar lançamento" rotuloBotao="Estornar" onFechar={() => setEstornar(null)}
        enviar={(motivo) => api.post(`/caixa/lancamentos/${estornar}/estornar`, { motivo })} onOk={() => { recarregar(); avisar('Lançamento estornado.'); setEstornar(null); }} />
    </div>
  );
}

function FormAjuste({ aberto, contas, contaId, onFechar, onOk }: { aberto: boolean; contas: ContaCaixa[]; contaId: string; onFechar: () => void; onOk: () => void }) {
  const [f, setF] = useState({ contaId, tipo: 'ENTRADA', valor: null as number | null, descricao: '', motivo: '', data: hojeIso() });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const [vistoAberto, setVisto] = useState(false);
  if (aberto !== vistoAberto) { setVisto(aberto); if (aberto) { setF({ contaId, tipo: 'ENTRADA', valor: null, descricao: '', motivo: '', data: hojeIso() }); setErro(null); setCampos({}); } }
  const m = useMutation({
    mutationFn: () => api.post('/caixa/ajustes', { contaId: f.contaId, data: f.data, valorCentavos: (f.valor ?? 0) * (f.tipo === 'SAIDA' ? -1 : 1), descricao: f.descricao, motivo: f.motivo }),
    onSuccess: onOk, onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Novo lançamento no caixa">
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao rotulo="Conta" value={f.contaId} onChange={(e) => setF({ ...f, contaId: e.target.value })}>{contas.filter((c) => c.status === 'ATIVO').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
        <div className="linha">
          <Selecao rotulo="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="ENTRADA">Entrada (dinheiro entra)</option><option value="SAIDA">Saída (dinheiro sai)</option></Selecao>
          <CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorCentavos} />
          <Campo rotulo="Data" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} erro={campos.data} />
        </div>
        <Campo rotulo="Descrição" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={campos.descricao} dica="Ex.: tarifa bancária, sangria, aporte." />
        <Campo rotulo="Motivo" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} erro={campos.motivo} dica="Fica registrado na auditoria." />
        <Botao carregando={m.isPending} onClick={() => m.mutate()}>Registrar</Botao>
      </div>
    </Dialogo>
  );
}

function FormTransferencia({ aberto, contas, contaId, onFechar, onOk }: { aberto: boolean; contas: ContaCaixa[]; contaId: string; onFechar: () => void; onOk: () => void }) {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const outras = useQuery({ queryKey: ['contas-todas'], queryFn: () => api.get<{ id: string; nome: string; empresaId: string; status: string }[]>('/contas-financeiras'), enabled: aberto && eu.rede });
  const [f, setF] = useState({ origem: contaId, destino: '', valor: null as number | null, descricao: '', data: hojeIso() });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const [vistoAberto, setVisto] = useState(false);
  if (aberto !== vistoAberto) { setVisto(aberto); if (aberto) { setF({ origem: contaId, destino: '', valor: null, descricao: '', data: hojeIso() }); setErro(null); setCampos({}); } }
  const m = useMutation({
    mutationFn: () => api.post('/caixa/transferencias', { contaOrigemId: f.origem, contaDestinoId: f.destino, valorCentavos: f.valor ?? 0, descricao: f.descricao, data: f.data }),
    onSuccess: onOk, onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  const destinos = eu.rede ? (outras.data ?? []).filter((c) => c.status === 'ATIVO') : contas.filter((c) => c.status === 'ATIVO').map((c) => ({ ...c, empresaId: eu.empresaAtivaId! }));
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Transferir entre contas">
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao rotulo="De" value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>{contas.filter((c) => c.status === 'ATIVO').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
        <Selecao rotulo="Para" obrigatorio value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} erro={campos.contaDestinoId}
          dica={eu.rede ? 'Como Administrativo, você pode transferir para conta de outra loja do grupo.' : 'Contas da sua loja.'}>
          <option value="">Escolha…</option>{destinos.filter((c) => c.id !== f.origem).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.empresaId !== eu.empresaAtivaId ? ' (outra loja)' : ''}</option>)}
        </Selecao>
        <div className="linha"><CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorCentavos} /><Campo rotulo="Data" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
        <Campo rotulo="Descrição" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={campos.descricao} />
        <Botao carregando={m.isPending} onClick={() => m.mutate()}>Transferir</Botao>
      </div>
    </Dialogo>
  );
}

function FormMotivo({ aberto, titulo, rotuloBotao, enviar, onOk, onFechar }: { aberto: boolean; titulo: string; rotuloBotao: string; enviar: (motivo: string) => Promise<unknown>; onOk: () => void; onFechar: () => void }) {
  const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => enviar(motivo), onSuccess: () => { setMotivo(''); setErro(null); onOk(); }, onError: (e) => setErro(mensagemDoErro(e)) });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo={titulo}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} dica="Mínimo de 5 caracteres. Fica registrado na auditoria." />
        <Botao variante="perigo" carregando={m.isPending} onClick={() => m.mutate()}>{rotuloBotao}</Botao>
      </div>
    </Dialogo>
  );
}

function Fechamentos({ eu, contas }: { eu: Eu; contas: ContaCaixa[] }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['caixa', 'fechamentos', eu.empresaAtivaId], queryFn: () => api.get<{ dias: FechamentoDia[]; meses: FechamentoMes[] }>('/caixa/fechamentos') });
  const [f, setF] = useState({ contaId: contas[0]?.id ?? '', data: hojeIso(), contado: null as number | null, observacao: '' });
  const [erro, setErro] = useState<string | null>(null); const [diferenca, setDiferenca] = useState<{ sistema: number; diferenca: number } | null>(null);
  const [mes, setMes] = useState(''); const [erroMes, setErroMes] = useState<string | null>(null);
  const [reabrir, setReabrir] = useState<{ tipo: 'dia' | 'mes'; id: string } | null>(null);
  const recarregar = () => qc.invalidateQueries({ queryKey: ['caixa'] });
  const fechar = useMutation({
    mutationFn: () => api.post('/caixa/fechar-dia', { contaId: f.contaId, data: f.data, saldoContadoCentavos: f.contado ?? 0, observacao: f.observacao }),
    onSuccess: () => { recarregar(); avisar('Dia fechado.'); setErro(null); setDiferenca(null); setF({ ...f, contado: null, observacao: '' }); },
    onError: (e) => { setErro(mensagemDoErro(e)); const c = (e as ErroApi).corpo; setDiferenca(c?.diferencaCentavos != null ? { sistema: c.saldoSistemaCentavos as number, diferenca: c.diferencaCentavos as number } : null); },
  });
  const fecharMes = useMutation({
    mutationFn: () => api.post('/caixa/fechar-periodo', { mes }),
    onSuccess: () => { recarregar(); avisar('Mês fechado.'); setErroMes(null); }, onError: (e) => setErroMes(mensagemDoErro(e)),
  });
  const podeFechar = eu.permissoes.includes('caixa.fechar');
  return (
    <div className="pilha">
      {podeFechar && (
        <div className="cartao pilha">
          <h2>Fechar o dia</h2>
          <p className="mut">Conte o dinheiro (ou confira o extrato do banco) e informe o saldo. Depois de fechado, nada com essa data ou anterior entra na conta.</p>
          {erro && <Aviso tipo={diferenca ? 'aviso' : 'erro'}>{erro}</Aviso>}
          <div className="linha">
            <Selecao rotulo="Conta" value={f.contaId} onChange={(e) => setF({ ...f, contaId: e.target.value })}>{contas.filter((c) => c.status === 'ATIVO').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>
            <Campo rotulo="Dia" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
            <CampoDinheiro rotulo="Saldo contado (R$)" centavos={f.contado} onChange={(v) => setF({ ...f, contado: v })} />
            <Campo rotulo={diferenca ? 'Explique a diferença' : 'Observação'} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
            <Botao carregando={fechar.isPending} onClick={() => fechar.mutate()}>Fechar o dia</Botao>
          </div>
          {diferenca && <span className="peq mut">Saldo no sistema: {formatarBRL(diferenca.sistema)} · diferença: {formatarBRL(diferenca.diferenca)}</span>}
        </div>
      )}
      <div className="cartao pilha">
        <h2>Dias fechados</h2>
        {lista.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Dia</th><th>Conta</th><th className="num">Sistema</th><th className="num">Contado</th><th className="num">Diferença</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.data?.dias.map((d) => (
                <tr key={d.id}><td>{dataBr(d.data)}</td><td>{d.conta}</td><td className="num">{formatarBRL(d.saldoSistemaCentavos)}</td><td className="num">{formatarBRL(d.saldoContadoCentavos)}</td>
                  <td className="num">{d.diferencaCentavos === 0 ? '—' : formatarBRL(d.diferencaCentavos)}{d.observacao && <div className="peq mut" style={{ textAlign: 'right' }}>{d.observacao}</div>}</td>
                  <td>{d.status === 'FECHADO' ? <Pilula tipo="ok">✓ Fechado</Pilula> : <Pilula tipo="aviso">Reaberto</Pilula>}{d.fechadoPor && <div className="peq mut">{d.fechadoPor}</div>}</td>
                  <td>{d.status === 'FECHADO' && eu.permissoes.includes('caixa.reabrir_dia') && <Botao variante="sec" pequeno onClick={() => setReabrir({ tipo: 'dia', id: d.id })}>Reabrir</Botao>}</td></tr>
              ))}
              {lista.data?.dias.length === 0 && <tr><td colSpan={7} className="vazio">Nenhum dia fechado ainda.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="cartao pilha">
        <h2>Fechamento do mês</h2>
        <p className="mut">Fecha o mês da loja: depois disso, lançamentos e laudos daquele mês não mudam. Antes, o caixa de todas as contas precisa estar fechado até o último dia do mês.</p>
        {erroMes && <Aviso tipo="erro">{erroMes}</Aviso>}
        {eu.permissoes.includes('periodo.fechar') && <div className="linha"><Campo rotulo="Mês" type="month" max={hojeIso().slice(0, 7)} value={mes} onChange={(e) => setMes(e.target.value)} /><Botao carregando={fecharMes.isPending} disabled={!mes} onClick={() => fecharMes.mutate()}>Fechar o mês</Botao></div>}
        <div className="tw"><table>
          <thead><tr><th>Mês</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.meses.map((m) => (
              <tr key={m.id}><td>{m.mes.split('-').reverse().join('/')}</td><td>{m.status === 'FECHADO' ? <Pilula tipo="ok">✓ Fechado</Pilula> : <Pilula tipo="aviso">Reaberto</Pilula>}{m.motivoReabertura && <div className="peq mut">{m.motivoReabertura}</div>}</td>
                <td>{m.status === 'FECHADO' && eu.permissoes.includes('periodo.reabrir') && <Botao variante="sec" pequeno onClick={() => setReabrir({ tipo: 'mes', id: m.mes })}>Reabrir</Botao>}</td></tr>
            ))}
            {lista.data?.meses.length === 0 && <tr><td colSpan={3} className="vazio">Nenhum mês fechado ainda.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <FormMotivo aberto={!!reabrir} titulo={reabrir?.tipo === 'mes' ? 'Reabrir o mês' : 'Reabrir o dia'} rotuloBotao="Reabrir" onFechar={() => setReabrir(null)}
        enviar={(motivo) => api.post(reabrir!.tipo === 'mes' ? `/caixa/periodos/${reabrir!.id}/reabrir` : `/caixa/fechamentos/${reabrir!.id}/reabrir`, { motivo })}
        onOk={() => { recarregar(); avisar('Reaberto.'); setReabrir(null); }} />
    </div>
  );
}
