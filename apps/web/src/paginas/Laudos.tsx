import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { dataBr, hojeIso, mensagemDoErro } from '../formulario';
import type { ClienteItem, Eu, Laudo, Servico } from '../tipos';

type Pagina = { itens: Laudo[]; proximoAntesDoNumero: number | null };
const FILTRO0 = { de: hojeIso().slice(0, 8) + '01', ate: hojeIso(), placa: '', clienteId: '', servicoId: '', status: '', fila: '' };

function situacao(l: Laudo) {
  if (l.status === 'CANCELADO') return <Pilula tipo="erro">✕ Cancelado</Pilula>;
  if (l.cancelamentoPedidoEm) return <Pilula tipo="aviso">Cancelamento pedido</Pilula>;
  if (l.precoManual && !l.revisadoEm) return <Pilula tipo="aviso">Valor manual</Pilula>;
  return <Pilula tipo="ok">✓ Ativo</Pilula>;
}

export function Laudos() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const verMargem = eu.permissoes.includes('relatorio.margem');
  const [f, setF] = useState(FILTRO0);
  const [aplicado, setAplicado] = useState(FILTRO0);
  const [paginas, setPaginas] = useState<number[]>([]); // cursores já abertos; o último é o corrente
  const [sel, setSel] = useState<string | null>(null);
  const clientes = useQuery({ queryKey: ['clientes', ''], queryFn: () => api.get<ClienteItem[]>('/clientes?busca=') });
  const servicos = useQuery({ queryKey: ['servicos'], queryFn: () => api.get<Servico[]>('/servicos') });
  const cursor = paginas[paginas.length - 1];
  const qs = new URLSearchParams();
  if (aplicado.de) qs.set('de', aplicado.de); if (aplicado.ate) qs.set('ate', aplicado.ate);
  if (aplicado.placa) qs.set('placa', aplicado.placa); if (aplicado.clienteId) qs.set('clienteId', aplicado.clienteId);
  if (aplicado.servicoId) qs.set('servicoId', aplicado.servicoId); if (aplicado.status) qs.set('status', aplicado.status);
  if (aplicado.fila === 'revisar') qs.set('revisar', '1'); if (aplicado.fila === 'cancelamento') qs.set('cancelamentoPedido', '1');
  if (cursor) qs.set('antesDoNumero', String(cursor));
  const lista = useQuery({ queryKey: ['laudos', 'lista', qs.toString()], queryFn: () => api.get<Pagina>(`/laudos?${qs}`) });
  const aplicar = () => { setPaginas([]); setAplicado(f); };
  const ehVis = eu.perfilAtivo === 'VISTORIADOR';

  return (
    <div className="pilha">
      <div className="cabeca"><div><h1>{ehVis ? 'Meus laudos' : 'Laudos'}</h1><p className="mut">{ehVis ? 'Os laudos que você lançou nesta loja.' : 'Laudos da loja ativa. Os valores ficam gravados como foram lançados; reajustes futuros não os alteram.'}</p></div></div>
      <form className="cartao pilha" onSubmit={(e) => { e.preventDefault(); aplicar(); }}>
        <div className="linha">
          <Campo rotulo="De" type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} />
          <Campo rotulo="Até" type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} />
          <Campo rotulo="Placa" value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} style={{ width: 120 }} />
          {!ehVis && <Selecao rotulo="Cliente" value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })}><option value="">Todos</option>{clientes.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Selecao>}
          <Selecao rotulo="Serviço" value={f.servicoId} onChange={(e) => setF({ ...f, servicoId: e.target.value })}><option value="">Todos</option>{servicos.data?.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</Selecao>
          <Selecao rotulo="Situação" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todas</option><option value="ATIVO">Ativos</option><option value="CANCELADO">Cancelados</option></Selecao>
          {eu.permissoes.includes('laudo.revisar_preco_manual') && (
            <Selecao rotulo="Fila de trabalho" value={f.fila} onChange={(e) => setF({ ...f, fila: e.target.value })}><option value="">Nenhuma</option><option value="revisar">Valores manuais a revisar</option><option value="cancelamento">Pedidos de cancelamento</option></Selecao>
          )}
          <Botao type="submit">Filtrar</Botao>
        </div>
      </form>
      <div className="cartao">
        {lista.isLoading ? <Carregando /> : lista.isError ? <Aviso tipo="erro">{mensagemDoErro(lista.error)}</Aviso> : (
          <div className="tw"><table>
            <thead><tr><th>Nº</th><th>Data</th><th>Placa</th><th>Cliente</th><th>Serviço</th><th>Vistoriador</th><th>Forma</th><th className="num">Valor</th>{verMargem && <th className="num">Margem</th>}<th>Situação</th></tr></thead>
            <tbody>
              {lista.data?.itens.map((l) => (
                <tr key={l.id} onClick={() => setSel(l.id)} style={{ cursor: 'pointer' }}>
                  <td><button type="button" className="btn-link" onClick={() => setSel(l.id)} style={{ background: 'none', border: 0, color: 'var(--verde)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>{l.numero}</button></td>
                  <td>{dataBr(l.dataLaudo)}</td><td><b>{l.placa}</b></td><td>{l.cliente}</td><td>{l.servico}</td><td>{l.vistoriador}</td><td>{l.forma}</td>
                  <td className="num">{formatarBRL(l.valorCobradoCentavos)}</td>{verMargem && <td className="num">{l.margemCentavos != null ? formatarBRL(l.margemCentavos) : '—'}</td>}
                  <td>{situacao(l)}</td>
                </tr>
              ))}
              {lista.data?.itens.length === 0 && <tr><td colSpan={10} className="vazio">Nenhum laudo com estes filtros.</td></tr>}
            </tbody>
          </table></div>
        )}
        <div className="linha entre" style={{ marginTop: 12 }}>
          <Botao variante="sec" pequeno disabled={paginas.length === 0} onClick={() => setPaginas(paginas.slice(0, -1))}>← Mais recentes</Botao>
          <Botao variante="sec" pequeno disabled={!lista.data?.proximoAntesDoNumero} onClick={() => setPaginas([...paginas, lista.data!.proximoAntesDoNumero!])}>Mais antigos →</Botao>
        </div>
      </div>
      <Detalhe id={sel} eu={eu} onFechar={() => setSel(null)} />
    </div>
  );
}

function Detalhe({ id, eu, onFechar }: { id: string | null; eu: Eu; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const d = useQuery({ queryKey: ['laudos', 'detalhe', id], enabled: !!id, queryFn: () => api.get<Laudo>(`/laudos/${id}`) });
  const [acao, setAcao] = useState<null | 'solicitar' | 'cancelar' | 'rejeitar' | 'corrigir'>(null);
  const [ed, setEd] = useState({ placa: '', chassi: '', numeroLaudo: '', observacao: '', dataLaudo: '' });
  const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const l = d.data;
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['laudos'] }); };
  const fechar = () => { setAcao(null); setMotivo(''); setErro(null); onFechar(); };
  const rodar = useMutation({
    mutationFn: (v: { caminho: string; corpo?: unknown }) => api.post(`/laudos/${id}/${v.caminho}`, v.corpo),
    onSuccess: (_r, v) => { recarregar(); avisar({ 'solicitar-cancelamento': 'Pedido de cancelamento enviado ao gerente.', cancelar: 'Laudo cancelado.', 'rejeitar-cancelamento': 'Pedido recusado.', revisar: 'Valor revisado.' }[v.caminho] ?? 'Feito.'); setAcao(null); setMotivo(''); setErro(null); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const corrigir = useMutation({
    mutationFn: (v: unknown) => api.patch(`/laudos/${id}`, v),
    onSuccess: () => { recarregar(); avisar('Laudo corrigido.'); setAcao(null); setErro(null); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const pode = (p: Parameters<Eu['permissoes']['includes']>[0]) => eu.permissoes.includes(p);
  const ativo = l?.status === 'ATIVO';
  const meuPedido = l?.cancelamentoPedidoPorId === eu.id;

  return (
    <Dialogo aberto={!!id} onFechar={fechar} titulo={l ? `Laudo nº ${l.numero} · ${l.placa}` : 'Laudo'} lateral>
      {!l ? <Carregando /> : (
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="linha">{situacao(l)}{l.travado && <Pilula tipo="info">Fechado para alteração</Pilula>}</div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
            {([['Data', dataBr(l.dataLaudo)], ['Nº do laudo', l.numeroLaudo ?? '—'], ['Chassi', l.chassi ?? '—'], ['Cliente', l.cliente], ['Serviço', l.servico], ['Vistoriador', l.vistoriador], ['Forma de pagamento', l.forma], ['Lançado por', `${l.criadoPor ?? '—'} em ${dataBr(l.criadoEm)}`]] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt className="mut">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>
            ))}
          </dl>
          <div className="cartao pilha" style={{ background: 'var(--suave)', padding: 16, gap: 8 }}>
            <div className="linha entre"><span>Preço de tabela (na data)</span><b className="num">{l.precoTabelaCentavos == null ? 'sem preço' : formatarBRL(l.precoTabelaCentavos)}</b></div>
            {l.descontoCentavos !== 0 && <div className="linha entre"><span>{l.descontoCentavos > 0 ? 'Desconto' : 'Acréscimo'}</span><b className="num">{formatarBRL(Math.abs(l.descontoCentavos))}</b></div>}
            <div className="linha entre"><span>Valor cobrado</span><b className="num" style={{ fontSize: 20 }}>{formatarBRL(l.valorCobradoCentavos)}</b></div>
            {l.ajusteMotivo && <span className="peq mut">Motivo: {l.ajusteMotivo}</span>}
            {l.duplicidadeMotivo && <span className="peq mut">Liberado como duplicidade: {l.duplicidadeMotivo}</span>}
          </div>
          {l.precoManual && (
            <Aviso tipo={l.revisadoEm ? 'ok' : 'aviso'}>
              {l.revisadoEm ? `Valor manual revisado em ${dataBr(l.revisadoEm)}.` : 'O cliente não tinha preço cadastrado: este valor foi digitado no lançamento e aguarda revisão do gerente.'}
            </Aviso>
          )}
          {l.custos && (
            <div className="pilha" style={{ gap: 6 }}>
              <h3>Custos gravados no lançamento</h3>
              {l.custos.length === 0 ? <span className="mut">Este serviço não tinha custos cadastrados.</span> : l.custos.map((k, i) => (
                <div key={i} className="linha entre"><span>{k.descricao}{k.geraContaPagar ? ' · gera conta a pagar' : ''}</span><span className="num">{formatarBRL(k.valorCentavos)}</span></div>
              ))}
              <div className="linha entre"><b>Margem</b><b className="num">{formatarBRL(l.margemCentavos ?? 0)}</b></div>
            </div>
          )}
          {l.observacao && <p><span className="mut">Observação: </span>{l.observacao}</p>}
          {l.status === 'CANCELADO' && <Aviso tipo="erro">Cancelado em {dataBr(l.canceladoEm)}. Motivo: {l.motivoCancelamento}</Aviso>}
          {l.cancelamentoPedidoEm && ativo && <Aviso tipo="aviso">Cancelamento pedido por {l.cancelamentoPedidoPor}: {l.cancelamentoPedidoMotivo}</Aviso>}

          {ativo && acao === null && (
            <div className="linha">
              {pode('laudo.revisar_preco_manual') && l.precoManual && !l.revisadoEm && (<>
                <Botao carregando={rodar.isPending} onClick={() => rodar.mutate({ caminho: 'revisar', corpo: { promoverPreco: false } })}>Aprovar valor</Botao>
                <Botao variante="sec" disabled={rodar.isPending} onClick={() => rodar.mutate({ caminho: 'revisar', corpo: { promoverPreco: true } })}>Aprovar e cadastrar como preço do cliente</Botao>
              </>)}
              {pode('laudo.cancelamento_autorizar') && !l.travado && <Botao variante="perigo" onClick={() => setAcao('cancelar')}>Cancelar laudo</Botao>}
              {pode('laudo.cancelamento_autorizar') && l.cancelamentoPedidoEm && !meuPedido && <Botao variante="sec" onClick={() => setAcao('rejeitar')}>Recusar pedido</Botao>}
              {(pode('laudo.editar') || pode('laudo.editar_proprio_dia')) && !l.travado && (
                <Botao variante="sec" onClick={() => { setEd({ placa: l.placa, chassi: l.chassi ?? '', numeroLaudo: l.numeroLaudo ?? '', observacao: l.observacao ?? '', dataLaudo: l.dataLaudo }); setAcao('corrigir'); }}>Corrigir dados</Botao>
              )}
              {!pode('laudo.cancelamento_autorizar') && pode('laudo.cancelamento_solicitar') && !l.cancelamentoPedidoEm && !l.travado && <Botao variante="sec" onClick={() => setAcao('solicitar')}>Pedir cancelamento</Botao>}
            </div>
          )}
          {acao === 'corrigir' && (
            <div className="pilha">
              <Campo rotulo="Placa" value={ed.placa} onChange={(e) => setEd({ ...ed, placa: e.target.value.toUpperCase() })} />
              <Campo rotulo="Chassi" value={ed.chassi} onChange={(e) => setEd({ ...ed, chassi: e.target.value.toUpperCase() })} />
              <Campo rotulo="Nº do laudo" value={ed.numeroLaudo} onChange={(e) => setEd({ ...ed, numeroLaudo: e.target.value })} />
              {pode('laudo.editar') && <Campo rotulo="Data do laudo" type="date" max={hojeIso()} value={ed.dataLaudo} onChange={(e) => setEd({ ...ed, dataLaudo: e.target.value })} dica="Mudar a data pode mudar o preço de tabela aplicado." />}
              <Campo rotulo="Observação" value={ed.observacao} onChange={(e) => setEd({ ...ed, observacao: e.target.value })} />
              <div className="linha">
                <Botao carregando={corrigir.isPending} onClick={() => corrigir.mutate({
                  placa: ed.placa, chassi: ed.chassi.trim() ? ed.chassi : null, numeroLaudo: ed.numeroLaudo.trim() ? ed.numeroLaudo : null, observacao: ed.observacao.trim() ? ed.observacao : null,
                  ...(pode('laudo.editar') && ed.dataLaudo !== l.dataLaudo ? { dataLaudo: ed.dataLaudo } : {}),
                })}>Salvar correção</Botao>
                <Botao variante="sec" onClick={() => { setAcao(null); setErro(null); }}>Voltar</Botao>
              </div>
            </div>
          )}
          {acao && acao !== 'corrigir' && (
            <div className="pilha">
              <Campo rotulo={acao === 'rejeitar' ? 'Motivo da recusa' : 'Motivo'} obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} dica="Fica registrado na auditoria. Mínimo de 5 caracteres." />
              <div className="linha">
                <Botao variante={acao === 'rejeitar' ? 'sec' : 'perigo'} carregando={rodar.isPending}
                  onClick={() => rodar.mutate({ caminho: acao === 'solicitar' ? 'solicitar-cancelamento' : acao === 'rejeitar' ? 'rejeitar-cancelamento' : 'cancelar', corpo: { motivo } })}>
                  {acao === 'solicitar' ? 'Enviar pedido' : acao === 'rejeitar' ? 'Recusar pedido' : 'Confirmar cancelamento'}
                </Botao>
                <Botao variante="sec" onClick={() => { setAcao(null); setErro(null); }}>Voltar</Botao>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  );
}
