import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { clienteSchema, formatarBRL, formatarCnpj, precoSchema, type Perfil } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { CampoDinheiro, CampoPercentual, camposDoErro, checar, dataBr, hojeIso, mensagemDoErro, pct } from '../formulario';
import type { ClienteDetalhe, ClienteItem, Eu, Preco, Servico } from '../tipos';

const fmtDoc = (d?: string | null) => (!d ? 'sem documento' : d.length === 14 ? formatarCnpj(d) : `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`);
const PERIODO = { SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal' } as const;

export function Clientes() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const lista = useQuery({ queryKey: ['clientes', busca], queryFn: () => api.get<ClienteItem[]>(`/clientes?busca=${encodeURIComponent(busca)}`) });
  const pode = eu.permissoes.includes('cliente.editar');

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Clientes e preços</h1><p className="mut">O cliente é do grupo e o preço vale para todas as lojas dele.</p></div>
        {pode && <Botao onClick={() => setNovo(true)}>Novo cliente</Botao>}
      </div>
      <div className="grade" style={{ gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(0, 2.6fr)', alignItems: 'start' }}>
        <div className="cartao pilha">
          <Campo rotulo="Buscar" placeholder="Nome ou documento" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {lista.isLoading ? <Carregando /> : (
            <div className="pilha" style={{ gap: 8 }}>
              {lista.data?.map((c) => (
                <button key={c.id} type="button" onClick={() => setSel(c.id)} aria-pressed={sel === c.id}
                  style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 12, border: `1.5px solid ${sel === c.id ? 'var(--verde)' : 'var(--borda)'}`, background: sel === c.id ? 'var(--suave)' : '#fff', cursor: 'pointer' }}>
                  <b>{c.nome}</b>{c.status === 'INATIVO' && <> <Pilula>Inativo</Pilula></>}
                  <div className="peq mut">{fmtDoc(c.documento)}</div>
                </button>
              ))}
              {lista.data?.length === 0 && <p className="vazio">Nenhum cliente encontrado.</p>}
            </div>
          )}
        </div>
        {sel ? <Detalhe id={sel} eu={eu} /> : <div className="cartao vazio">Escolha um cliente para ver a cobrança e a tabela de preços.</div>}
      </div>
      <FormNovo aberto={novo} onFechar={() => setNovo(false)} onCriado={(id) => { setNovo(false); setSel(id); }} />
    </div>
  );
}

function FormNovo({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: (id: string) => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const [f, setF] = useState({ tipoPessoa: 'PJ', documento: '', nome: '', emails: '', telefone: '' });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => api.post<{ id: string }>('/clientes', v),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['clientes'] }); avisar('Cliente cadastrado.'); setF({ tipoPessoa: 'PJ', documento: '', nome: '', emails: '', telefone: '' }); onCriado(r.id); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => {
    setErro(null);
    const emailsCobranca = f.emails.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
    const r = checar(clienteSchema, { tipoPessoa: f.tipoPessoa, documento: f.documento, nome: f.nome, telefone: f.telefone, emailsCobranca });
    if (r.erros) { setErros(r.erros); return; }
    setErros({}); salvar.mutate(r.dados);
  };
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Novo cliente">
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao rotulo="Tipo" value={f.tipoPessoa} onChange={(e) => setF({ ...f, tipoPessoa: e.target.value })}><option value="PJ">Empresa (CNPJ)</option><option value="PF">Pessoa física (CPF)</option></Selecao>
        <Campo rotulo={f.tipoPessoa === 'PJ' ? 'CNPJ' : 'CPF'} inputMode="numeric" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} erro={erros.documento} dica="Opcional. Cliente de balcão pode ficar sem documento." />
        <Campo rotulo="Nome ou razão social" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={erros.nome} />
        <AreaTexto rotulo="E-mails de cobrança" dica="Um por linha. A fatura será enviada para eles." value={f.emails} onChange={(e) => setF({ ...f, emails: e.target.value })} erro={erros.emailsCobranca} />
        <Campo rotulo="Telefone" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
        <Aviso>A fatura nasce mensal, com vencimento em 10 dias, multa de 2% e juros de 1% ao mês. Você ajusta depois, na tela do cliente.</Aviso>
        <Botao carregando={salvar.isPending} onClick={enviar}>Cadastrar cliente</Botao>
      </div>
    </Dialogo>
  );
}

function Detalhe({ id, eu }: { id: string; eu: Eu }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const d = useQuery({ queryKey: ['cliente', id], queryFn: () => api.get<ClienteDetalhe>(`/clientes/${id}`) });
  const servicos = useQuery({ queryKey: ['servicos'], queryFn: () => api.get<Servico[]>('/servicos') });
  const [preco, setPreco] = useState<{ servico: Servico; atual: Preco | null } | null>(null);
  const pode = eu.permissoes.includes('cliente.editar');
  const podePrimeiro = eu.permissoes.includes('preco.cadastrar_primeiro');
  const podeReajustar = eu.permissoes.includes('preco.reajustar');
  const hoje = hojeIso();
  const c = d.data;

  const [edit, setEdit] = useState<{ periodicidade: string; prazoDias: string; multaBp: number | null; jurosMesBp: number | null; emails: string; telefone: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => api.patch(`/clientes/${id}`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cliente', id] }); qc.invalidateQueries({ queryKey: ['clientes'] }); avisar('Cliente atualizado.'); setEdit(null); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  if (d.isLoading || !c) return <div className="cartao"><Carregando /></div>;
  const form = edit ?? { periodicidade: c.periodicidade, prazoDias: String(c.prazoDias), multaBp: c.multaBp, jurosMesBp: c.jurosMesBp, emails: c.emailsCobranca.join('\n'), telefone: c.telefone ?? '' };
  const vigente = (sid: string) => c.precos.find((p) => p.servicoId === sid && p.vigenciaIni.slice(0, 10) <= hoje && (!p.vigenciaFim || p.vigenciaFim.slice(0, 10) >= hoje)) ?? null;
  const futuro = (sid: string) => c.precos.find((p) => p.servicoId === sid && p.vigenciaIni.slice(0, 10) > hoje) ?? null;

  return (
    <div className="pilha">
      <div className="cartao pilha">
        <div className="cabeca"><div><h2>{c.nome}</h2><p className="mut peq">{c.tipoPessoa === 'PJ' ? 'Empresa' : 'Pessoa física'} · {fmtDoc(c.documento)}</p></div>
          <div className="linha" style={{ alignItems: 'center' }}>{c.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativo</Pilula> : <Pilula>Inativo</Pilula>}
            {pode && <Botao variante="sec" pequeno onClick={() => salvar.mutate({ status: c.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' })}>{c.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao>}</div></div>
        <h3>Cobrança e faturamento</h3>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grade g2">
          <Selecao rotulo="Fatura" value={form.periodicidade} disabled={!pode} onChange={(e) => setEdit({ ...form, periodicidade: e.target.value })}>{Object.entries(PERIODO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selecao>
          <Campo rotulo="Prazo para pagar (dias)" inputMode="numeric" disabled={!pode} value={form.prazoDias} onChange={(e) => setEdit({ ...form, prazoDias: e.target.value })} />
          <CampoPercentual rotulo="Multa por atraso (%)" bp={form.multaBp} onChange={(b) => setEdit({ ...form, multaBp: b })} />
          <CampoPercentual rotulo="Juros ao mês (%)" bp={form.jurosMesBp} onChange={(b) => setEdit({ ...form, jurosMesBp: b })} />
        </div>
        <AreaTexto rotulo="E-mails de cobrança" dica="Um por linha." disabled={!pode} value={form.emails} onChange={(e) => setEdit({ ...form, emails: e.target.value })} />
        {pode && edit && <div className="linha"><Botao carregando={salvar.isPending} onClick={() => { setErro(null); salvar.mutate({ periodicidade: edit.periodicidade, prazoDias: Number(edit.prazoDias), multaBp: edit.multaBp ?? 0, jurosMesBp: edit.jurosMesBp ?? 0, emailsCobranca: edit.emails.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean), telefone: edit.telefone || null }); }}>Salvar</Botao><Botao variante="sec" onClick={() => setEdit(null)}>Descartar</Botao></div>}
        {!pode && <p className="peq mut">Seu perfil consulta os dados do cliente.</p>}
      </div>

      {eu.rede && c.tipoPessoa === 'PF' && <Privacidade id={id} nome={c.nome} />}

      <div className="cartao pilha">
        <h2>Tabela de preços</h2>
        <div className="tw"><table>
          <thead><tr><th>Serviço</th><th className="num">Preço hoje</th><th>Vigente desde</th><th>Próximo preço</th><th /></tr></thead>
          <tbody>
            {servicos.data?.filter((s) => s.status !== 'INATIVO').map((s) => {
              const v = vigente(s.id); const f = futuro(s.id); const tem = c.precos.some((p) => p.servicoId === s.id);
              return (
                <tr key={s.id}>
                  <td><b>{s.nome}</b></td>
                  <td className="num">{v ? formatarBRL(v.valorCentavos) : <Pilula tipo="aviso">! Sem preço</Pilula>}</td>
                  <td>{v ? dataBr(v.vigenciaIni) : '—'}</td>
                  <td>{f ? <>{formatarBRL(f.valorCentavos)} <span className="peq mut">a partir de {dataBr(f.vigenciaIni)}</span></> : '—'}</td>
                  <td>{!tem ? (podePrimeiro && <Botao pequeno onClick={() => setPreco({ servico: s, atual: null })}>Cadastrar primeiro preço</Botao>)
                    : podeReajustar ? <Botao variante="sec" pequeno onClick={() => setPreco({ servico: s, atual: v ?? f })}>Reajustar</Botao>
                    : <span className="peq mut">🔒 reajuste só pelo Administrativo</span>}</td>
                </tr>
              );
            })}
            {servicos.data?.length === 0 && <tr><td colSpan={5} className="vazio">Nenhum serviço cadastrado. Cadastre os serviços em Cadastros.</td></tr>}
          </tbody>
        </table></div>
        <p className="peq mut">{podeReajustar ? 'Reajustar encerra o preço atual na véspera e começa o novo na data escolhida. Laudos já lançados não mudam.' : 'O Gerente cadastra o primeiro preço. Reajustar um preço que já existe é do Administrativo, porque o novo valor muda em todas as lojas.'}</p>
        {c.precos.length > 0 && (
          <details><summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--verde)' }}>Histórico de preços</summary>
            <div className="tw" style={{ marginTop: 8 }}><table>
              <thead><tr><th>Serviço</th><th className="num">Valor</th><th>De</th><th>Até</th><th>Motivo</th></tr></thead>
              <tbody>{c.precos.map((p) => <tr key={p.id}><td>{p.servico}</td><td className="num">{formatarBRL(p.valorCentavos)}</td><td>{dataBr(p.vigenciaIni)}</td><td>{p.vigenciaFim ? dataBr(p.vigenciaFim) : 'em vigor'}</td><td>{p.motivo ?? '—'}</td></tr>)}</tbody>
            </table></div></details>
        )}
      </div>
      <FormPreco clienteId={id} alvo={preco} podeReajustar={podeReajustar} onFechar={() => setPreco(null)} />
    </div>
  );
}

function FormPreco({ clienteId, alvo, onFechar }: { clienteId: string; alvo: { servico: Servico; atual: Preco | null } | null; podeReajustar: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const reajuste = !!alvo?.atual;
  const [valor, setValor] = useState<number | null>(null);
  const [ini, setIni] = useState(hojeIso());
  const [motivo, setMotivo] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => api.post(`/clientes/${clienteId}/precos`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cliente', clienteId] }); avisar(reajuste ? 'Reajuste cadastrado.' : 'Preço cadastrado.'); setValor(null); setMotivo(''); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => {
    setErro(null);
    const r = checar(precoSchema, { servicoId: alvo!.servico.id, valorCentavos: valor ?? 0, vigenciaIni: ini, motivo });
    if (r.erros) { setErros(r.erros); return; }
    if (reajuste && !motivo.trim()) { setErros({ motivo: 'Informe o motivo do reajuste.' }); return; }
    setErros({}); salvar.mutate(r.dados);
  };
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={`${reajuste ? 'Reajustar' : 'Primeiro preço de'} ${alvo?.servico.nome ?? ''}`}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {reajuste ? <Aviso tipo="aviso">O novo valor passa a valer em <b>todas as lojas do grupo</b>. O preço atual ({alvo?.atual ? formatarBRL(alvo.atual.valorCentavos) : ''}) é encerrado na véspera e laudos já lançados não mudam.</Aviso>
          : <Aviso>Este preço vale para todas as lojas do grupo. Depois de cadastrado, só o Administrativo reajusta.</Aviso>}
        <CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={valor} onChange={setValor} erro={erros.valorCentavos} />
        <Campo rotulo="Começa a valer em" type="date" min={reajuste ? hojeIso() : undefined} value={ini} onChange={(e) => setIni(e.target.value)} erro={erros.vigenciaIni} />
        {reajuste && <AreaTexto rotulo="Motivo do reajuste" obrigatorio dica="Fica no histórico e na auditoria." value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erros.motivo} />}
        <Botao carregando={salvar.isPending} onClick={enviar}>{reajuste ? 'Confirmar reajuste' : 'Cadastrar preço'}</Botao>
      </div>
    </Dialogo>
  );
}
export type { Perfil };

/** Pedidos de titulares de dados (LGPD): ver o que o sistema guarda e anonimizar. Só o Administrativo. */
function Privacidade({ id, nome }: { id: string; nome: string }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [dados, setDados] = useState<Record<string, unknown> | null>(null);
  const [confirmar, setConfirmar] = useState(false); const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const ver = useMutation({ mutationFn: () => api.get<Record<string, unknown>>(`/lgpd/clientes/${id}/dados`), onSuccess: setDados, onError: (e) => setErro(mensagemDoErro(e)) });
  const anon = useMutation({
    mutationFn: () => api.post(`/lgpd/clientes/${id}/anonimizar`, { motivo }),
    onSuccess: () => { avisar('Cliente anonimizado.'); setConfirmar(false); setDados(null); qc.invalidateQueries({ queryKey: ['cliente', id] }); qc.invalidateQueries({ queryKey: ['clientes'] }); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  return (
    <div className="cartao pilha">
      <h2>Privacidade (LGPD)</h2>
      <p className="mut peq">Pedido do titular dos dados: ver o que o sistema guarda sobre {nome} ou apagar o que identifica a pessoa. Valores e datas dos lançamentos ficam, pela obrigação legal de guarda de 5 anos. Cada consulta fica registrada na auditoria.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="linha"><Botao variante="sec" carregando={ver.isPending} onClick={() => { setErro(null); ver.mutate(); }}>Ver dados do titular</Botao><Botao variante="perigo" onClick={() => { setConfirmar(true); setErro(null); }}>Anonimizar</Botao></div>
      {dados && <pre style={{ background: 'var(--suave)', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 280, fontSize: 12 }}>{JSON.stringify(dados, null, 2)}</pre>}
      {confirmar && (
        <div className="pilha">
          <Aviso tipo="aviso">Isto apaga nome, CPF, e-mails e telefone e não tem volta. O cliente fica inativo.</Aviso>
          <Campo rotulo="Motivo (pedido do titular, data...)" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="linha"><Botao variante="perigo" carregando={anon.isPending} onClick={() => anon.mutate()}>Anonimizar de vez</Botao><Botao variante="sec" onClick={() => setConfirmar(false)}>Voltar</Botao></div>
        </div>
      )}
    </div>
  );
}
