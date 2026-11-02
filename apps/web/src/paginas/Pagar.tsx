import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { API_BASE, api, enviarArquivo } from '../api';
import { CampoDinheiro, dataBr, hojeIso, mensagemDoErro, plural } from '../formulario';
import type { ContaCaixa, CustoAApurar, Empresa, Eu, Fornecedor, PlanoConta, Recorrencia, StatusPagar, TituloPagar, TituloPagarDetalhe } from '../tipos';

const SITUACAO = { abertos: 'A pagar', vencidos: 'Vencidas', pendentes: 'Aguardando aprovação', rascunhos: 'Rascunhos', pagos: 'Pagas', cancelados: 'Canceladas', todos: 'Todas' } as const;
type Sit = keyof typeof SITUACAO;
const ORIGEM: Record<string, string> = { MANUAL: 'Manual', RECORRENCIA: 'Recorrente', ROYALTY: 'Royalty', COMISSAO: 'Comissão', CUSTO_LAUDO: 'Custo de laudos', RATEIO: 'Rateio' };
const FREQ = { SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal', ANUAL: 'Anual' } as const;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function pilula(t: { status: StatusPagar; vencido?: boolean }) {
  if (t.status === 'PAGO') return <Pilula tipo="ok">✓ Paga</Pilula>;
  if (t.status === 'CANCELADO') return <Pilula>Cancelada</Pilula>;
  if (t.status === 'RASCUNHO') return <Pilula>Rascunho</Pilula>;
  if (t.status === 'PENDENTE') return <Pilula tipo="aviso">Aguardando aprovação</Pilula>;
  if (t.vencido) return <Pilula tipo="erro">! Vencida</Pilula>;
  return t.status === 'PARCIAL' ? <Pilula tipo="info">Parcial</Pilula> : <Pilula tipo="neutra">Aprovada</Pilula>;
}

export function Pagar() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const ativa = eu.empresaAtivaId;
  const qc = useQueryClient();
  const [aba, setAba] = useState<'contas' | 'recorrencias' | 'custos' | 'rateio'>('contas');
  const [f, setF] = useState({ situacao: 'abertos' as Sit, fornecedorId: '', vencDe: '', vencAte: '' });
  const [aplicado, setAplicado] = useState(f);
  const [sel, setSel] = useState<string | null>(null); const [novo, setNovo] = useState(false);
  const fornecedores = useQuery({ queryKey: ['fornecedores'], queryFn: () => api.get<Fornecedor[]>('/fornecedores'), enabled: !!ativa });
  const resumo = useQuery({ queryKey: ['pagar', 'resumo', ativa], enabled: !!ativa, queryFn: () => api.get<{ aPagarCentavos: number; vencidoCentavos: number; vence7DiasCentavos: number; pendentesAprovacao: number; pagoNoMesCentavos: number }>('/pagar/resumo') });
  const qs = new URLSearchParams({ situacao: aplicado.situacao, limite: '200' });
  (['fornecedorId', 'vencDe', 'vencAte'] as const).forEach((k) => { if (aplicado[k]) qs.set(k, aplicado[k]); });
  const lista = useQuery({ queryKey: ['pagar', 'lista', ativa, qs.toString()], enabled: !!ativa && aba === 'contas', queryFn: () => api.get<{ itens: TituloPagar[]; total: number; saldoCentavos: number }>(`/pagar/titulos?${qs}`) });
  if (!ativa) return <Aviso tipo="aviso">Escolha a empresa em que está trabalhando, no alto da tela.</Aviso>;
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['pagar'] }); qc.invalidateQueries({ queryKey: ['caixa'] }); };
  const abas = [['contas', 'Contas'], ['recorrencias', 'Recorrentes'], ['custos', 'Custos de laudos'], ...(eu.rede ? [['rateio', 'Rateio entre lojas']] : [])] as [typeof aba, string][];
  return (
    <div className="pilha estreito">
      <div className="cabeca">
        <div><h1>A pagar</h1><p className="mut">Despesas, fornecedores e custos. Quem cria a conta não a aprova; o pagamento sai da conta escolhida e fica no caixa.</p></div>
        {eu.permissoes.includes('pagar.criar') && <Botao onClick={() => setNovo(true)}>Nova conta</Botao>}
      </div>
      <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {([['A pagar', resumo.data?.aPagarCentavos, 'aprovadas e em aberto'], ['Vencido', resumo.data?.vencidoCentavos, 'pague logo'], ['Vence em 7 dias', resumo.data?.vence7DiasCentavos, 'próxima semana'], ['Pago no mês', resumo.data?.pagoNoMesCentavos, `${resumo.data?.pendentesAprovacao ?? 0} aguardando aprovação`]] as const).map(([r, v, d]) => (
          <div key={r} className="cartao" style={{ padding: 16 }}><span className="peq mut">{r}</span><br /><b className="num" style={{ textAlign: 'left', fontSize: 22, color: r === 'Vencido' && (v ?? 0) > 0 ? 'var(--erro)' : undefined }}>{formatarBRL(v ?? 0)}</b><br /><span className="peq mut">{d}</span></div>
        ))}
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)', flexWrap: 'wrap' }}>
        {abas.map(([id, r]) => <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: aba === id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${aba === id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{r}</button>)}
      </div>
      {aba === 'contas' && (
        <>
          <form className="cartao" onSubmit={(e) => { e.preventDefault(); setAplicado(f); }}>
            <div className="linha">
              <Selecao rotulo="Situação" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value as Sit })}>{(Object.keys(SITUACAO) as Sit[]).map((k) => <option key={k} value={k}>{SITUACAO[k]}</option>)}</Selecao>
              <Selecao rotulo="Fornecedor" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })}><option value="">Todos</option>{fornecedores.data?.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
              <Campo rotulo="Vence de" type="date" value={f.vencDe} onChange={(e) => setF({ ...f, vencDe: e.target.value })} /><Campo rotulo="até" type="date" value={f.vencAte} onChange={(e) => setF({ ...f, vencAte: e.target.value })} />
              <Botao type="submit">Filtrar</Botao>
            </div>
          </form>
          <div className="cartao pilha">
            {lista.data && <span className="mut">{plural(lista.data.total, 'conta', 'contas')} · saldo a pagar nesta lista: {formatarBRL(lista.data.saldoCentavos)}</span>}
            {lista.isLoading ? <Carregando /> : lista.isError ? <Aviso tipo="erro">{mensagemDoErro(lista.error)}</Aviso> : (
              <div className="tw"><table>
                <thead><tr><th>Vencimento</th><th>Favorecido</th><th>Descrição</th><th>Origem</th><th className="num">Valor</th><th className="num">Saldo</th><th>Situação</th></tr></thead>
                <tbody>
                  {lista.data?.itens.map((t) => (
                    <tr key={t.id}><td>{dataBr(t.vencimento)}</td><td>{t.favorecido}</td>
                      <td><button type="button" onClick={() => setSel(t.id)} style={{ background: 'none', border: 0, color: 'var(--verde)', fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left' }}>{t.descricao}</button></td>
                      <td>{ORIGEM[t.origem]}</td><td className="num">{formatarBRL(t.valorCentavos)}</td><td className="num">{formatarBRL(t.saldoCentavos)}</td><td>{pilula(t)}</td></tr>
                  ))}
                  {lista.data?.itens.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma conta com estes filtros.</td></tr>}
                </tbody>
              </table></div>
            )}
          </div>
        </>
      )}
      {aba === 'recorrencias' && <Recorrencias eu={eu} fornecedores={fornecedores.data ?? []} onMudou={recarregar} />}
      {aba === 'custos' && <Custos onMudou={recarregar} />}
      {aba === 'rateio' && <Rateio fornecedores={fornecedores.data ?? []} empresas={empresas} onMudou={recarregar} />}
      <FormNova aberto={novo} fornecedores={fornecedores.data ?? []} onFechar={() => setNovo(false)} onOk={() => { setNovo(false); recarregar(); }} />
      <Detalhe id={sel} eu={eu} onFechar={() => setSel(null)} onMudou={recarregar} />
    </div>
  );
}

function usePlano() { return useQuery({ queryKey: ['plano-contas'], queryFn: () => api.get<PlanoConta[]>('/plano-contas') }); }
const opcoesPlano = (p?: PlanoConta[]) => p?.filter((c) => c.aceitaLancamento && c.status === 'ATIVO' && ['DESPESA', 'CUSTO'].includes(c.tipo)).map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>);

function FormNova({ aberto, fornecedores, onFechar, onOk }: { aberto: boolean; fornecedores: Fornecedor[]; onFechar: () => void; onOk: () => void }) {
  const { avisar } = useToast();
  const plano = usePlano();
  const vazio = { fornecedorId: '', beneficiario: '', descricao: '', planoContaId: '', vencimento: '', valor: null as number | null, numeroDocumento: '', observacao: '' };
  const [f, setF] = useState(vazio); const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const [visto, setVisto] = useState(false);
  if (aberto !== visto) { setVisto(aberto); if (aberto) { setF(vazio); setArquivo(null); setErro(null); setCampos({}); } }
  const m = useMutation({
    mutationFn: async (rascunho: boolean) => {
      const anexo = arquivo ? await enviarArquivo<{ id: string }>('/pagar/anexos', arquivo) : null;
      return api.post('/pagar/titulos', { fornecedorId: f.fornecedorId || undefined, beneficiario: f.beneficiario || undefined, descricao: f.descricao, planoContaId: f.planoContaId || undefined, vencimento: f.vencimento, valorCentavos: f.valor ?? 0, numeroDocumento: f.numeroDocumento || undefined, observacao: f.observacao || undefined, anexoId: anexo?.id, rascunho });
    },
    onSuccess: (_r, rascunho) => { avisar(rascunho ? 'Rascunho salvo.' : 'Conta criada.'); onOk(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Nova conta a pagar">
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao rotulo="Fornecedor" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })} erro={campos.fornecedorId} dica="Ou informe o favorecido abaixo, se não for fornecedor cadastrado."><option value="">Escolha…</option>{fornecedores.filter((x) => x.status === 'ATIVO').map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
        {!f.fornecedorId && <Campo rotulo="Favorecido" value={f.beneficiario} onChange={(e) => setF({ ...f, beneficiario: e.target.value })} erro={campos.beneficiario} />}
        <Campo rotulo="Descrição" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={campos.descricao} />
        <div className="linha"><Campo rotulo="Vencimento" type="date" obrigatorio value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} erro={campos.vencimento} /><CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorCentavos} /></div>
        <Selecao rotulo="Conta do plano (despesa)" value={f.planoContaId} onChange={(e) => setF({ ...f, planoContaId: e.target.value })} erro={campos.planoContaId}><option value="">Sem classificação</option>{opcoesPlano(plano.data)}</Selecao>
        <Campo rotulo="Nº do documento" value={f.numeroDocumento} onChange={(e) => setF({ ...f, numeroDocumento: e.target.value })} />
        <div className="fld"><label htmlFor="anexo-novo">Nota ou boleto (PDF, PNG ou JPG, até 5 MB)</label><input id="anexo-novo" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />{campos.arquivo && <small style={{ color: 'var(--erro)' }}>{campos.arquivo}</small>}</div>
        <div className="linha"><Botao carregando={m.isPending} onClick={() => m.mutate(false)}>Enviar para aprovação</Botao><Botao variante="sec" disabled={m.isPending} onClick={() => m.mutate(true)}>Salvar como rascunho</Botao></div>
      </div>
    </Dialogo>
  );
}

function Detalhe({ id, eu, onFechar, onMudou }: { id: string | null; eu: Eu; onFechar: () => void; onMudou: () => void }) {
  const { avisar } = useToast();
  const d = useQuery({ queryKey: ['pagar', 'detalhe', id], enabled: !!id, queryFn: () => api.get<TituloPagarDetalhe>(`/pagar/titulos/${id}`) });
  const contas = useQuery({ queryKey: ['caixa', 'contas-sel'], enabled: !!id, queryFn: () => api.get<{ contas: ContaCaixa[] }>('/caixa/contas') });
  const [modo, setModo] = useState<null | 'pagar' | 'rejeitar' | 'cancelar' | { estornar: string }>(null);
  const [f, setF] = useState({ data: hojeIso(), principal: null as number | null, juros: null as number | null, multa: null as number | null, desconto: null as number | null, conta: '', motivo: '' });
  const [comp, setComp] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const t = d.data;
  const fechar = () => { setModo(null); setErro(null); setCampos({}); onFechar(); };
  const fim = (msg: string) => () => { avisar(msg); onMudou(); setModo(null); setErro(null); setCampos({}); d.refetch(); };
  const falha = (e: unknown) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); };
  const aprovar = useMutation({ mutationFn: () => api.post<{ status: string; aprovacoesDadas?: number; aprovacoesNecessarias?: number }>(`/pagar/titulos/${id}/aprovar`), onSuccess: (r) => fim(r.status === 'APROVADO' ? 'Conta aprovada.' : `Aprovação registrada (${r.aprovacoesDadas} de ${r.aprovacoesNecessarias}). Falta mais uma.`)(), onError: falha });
  const enviar = useMutation({ mutationFn: () => api.post(`/pagar/titulos/${id}/enviar`), onSuccess: fim('Enviada para aprovação.'), onError: falha });
  const rejeitar = useMutation({ mutationFn: () => api.post(`/pagar/titulos/${id}/rejeitar`, { motivo: f.motivo }), onSuccess: fim('Conta devolvida como rascunho.'), onError: falha });
  const cancelar = useMutation({ mutationFn: () => api.post(`/pagar/titulos/${id}/cancelar`, { motivo: f.motivo }), onSuccess: fim('Conta cancelada.'), onError: falha });
  const pagar = useMutation({
    mutationFn: async () => {
      const anexo = comp ? await enviarArquivo<{ id: string }>('/pagar/anexos', comp) : null;
      return api.post(`/pagar/titulos/${id}/pagamentos`, { data: f.data, principalCentavos: f.principal ?? undefined, jurosCentavos: f.juros ?? undefined, multaCentavos: f.multa ?? undefined, descontoCentavos: f.desconto ?? undefined, contaId: f.conta || undefined, comprovanteId: anexo?.id, motivo: f.motivo || undefined });
    }, onSuccess: fim('Pagamento registrado.'), onError: falha,
  });
  const estornar = useMutation({ mutationFn: (pid: string) => api.post(`/pagar/pagamentos/${pid}/estornar`, { motivo: f.motivo }), onSuccess: fim('Pagamento estornado.'), onError: falha });
  const abrirAnexo = (aid: string) => window.open(`${API_BASE}/pagar/anexos/${aid}`, '_blank', 'noopener');
  const aberta = t && (t.status === 'APROVADO' || t.status === 'PARCIAL');
  const euCriei = t?.criadoPorId === eu.id && !eu.rede; // o Administrativo aprova até o que ele mesmo criou
  return (
    <Dialogo aberto={!!id} onFechar={fechar} titulo={t ? t.descricao : 'Conta a pagar'} lateral>
      {!t ? <Carregando /> : (
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="linha">{pilula(t)}<Pilula tipo="neutra">{ORIGEM[t.origem]}</Pilula></div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0 }}>
            {([['Favorecido', t.favorecido], ['Vencimento', dataBr(t.vencimento)], ['Competência', t.competencia.split('-').reverse().join('/')], ['Valor', formatarBRL(t.valorCentavos)], ['Pago', formatarBRL(t.pagoCentavos)], ['Saldo', formatarBRL(t.saldoCentavos)], ['Conta do plano', t.planoConta ?? '—'], ['Documento', t.numeroDocumento ?? '—'], ['Criada por', t.criadoPor ?? 'Sistema'], ['Aprovada por', t.aprovadoPor ?? '—']] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt className="mut">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>
            ))}
          </dl>
          {(t.status === 'PENDENTE' || t.aprovacoes.length > 0) && (
            <Aviso tipo={t.status === 'PENDENTE' ? 'aviso' : 'info'}>
              {t.requisitos.aprovacoes === 2 ? 'Pelo valor, esta conta precisa de duas aprovações de pessoas diferentes, ou da aprovação do Administrativo.' : t.requisitos.somenteAdministrativo ? 'Pelo valor, só o Administrativo aprova esta conta.' : 'Esta conta precisa de uma aprovação.'}
              {t.aprovacoes.length > 0 && <> Aprovações até agora: {t.aprovacoes.map((x) => x.usuario).join(', ')}.</>}
            </Aviso>
          )}
          {t.custos && <Aviso tipo="info">Reúne os custos de {t.custos.laudos} laudos de {dataBr(t.custos.de)} a {dataBr(t.custos.ate)}.</Aviso>}
          {t.motivoRejeicao && t.status === 'RASCUNHO' && <Aviso tipo="aviso">Devolvida: {t.motivoRejeicao}</Aviso>}
          {t.motivoCancelamento && <Aviso tipo="info">Cancelada: {t.motivoCancelamento}</Aviso>}
          {t.anexo && <Botao variante="sec" pequeno onClick={() => abrirAnexo(t.anexo!.id)}>Abrir anexo: {t.anexo.nome}</Botao>}
          <h3>Pagamentos</h3>
          {t.pagamentos.length === 0 ? <span className="mut">Nenhum pagamento ainda.</span> : (
            <div className="tw"><table>
              <thead><tr><th>Data</th><th>Conta</th><th className="num">Pago</th><th /></tr></thead>
              <tbody>{t.pagamentos.map((p) => (
                <tr key={p.id}><td>{dataBr(p.data)}</td><td>{p.conta}{p.motivo && <div className="peq mut">{p.motivo}</div>}</td>
                  <td className="num">{formatarBRL(p.pagoTotalCentavos)}{(p.jurosCentavos || p.multaCentavos || p.descontoCentavos) ? <div className="peq mut">juros {formatarBRL(p.jurosCentavos)} · multa {formatarBRL(p.multaCentavos)} · desc. {formatarBRL(p.descontoCentavos)}</div> : null}</td>
                  <td>{p.estornoDe ? <Pilula tipo="aviso">Estorno</Pilula> : p.estornado ? <Pilula>Estornado</Pilula> : (<>
                    {p.comprovanteId && <Botao variante="sec" pequeno onClick={() => abrirAnexo(p.comprovanteId!)}>Comprovante</Botao>}{' '}
                    {(eu.permissoes.includes('pagar.estornar') || eu.permissoes.includes('pagar.estornar_periodo_aberto')) && <Botao variante="sec" pequeno onClick={() => { setModo({ estornar: p.id }); setF({ ...f, motivo: '' }); }}>Estornar</Botao>}</>)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {modo === null && (
            <div className="linha">
              {t.status === 'PENDENTE' && eu.permissoes.includes('pagar.ver') && !euCriei && !t.aprovacoes.some((x) => x.usuario === eu.nome) && (<><Botao carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>Aprovar</Botao><Botao variante="sec" onClick={() => { setModo('rejeitar'); setF({ ...f, motivo: '' }); }}>Devolver</Botao></>)}
              {t.status === 'PENDENTE' && euCriei && <span className="mut peq">Quem criou a conta não pode aprová-la.</span>}
              {t.status === 'RASCUNHO' && <Botao carregando={enviar.isPending} onClick={() => enviar.mutate()}>Enviar para aprovação</Botao>}
              {aberta && eu.permissoes.includes('pagar.pagar') && <Botao onClick={() => { setModo('pagar'); setF({ data: hojeIso(), principal: null, juros: null, multa: null, desconto: null, conta: '', motivo: '' }); setComp(null); }}>Registrar pagamento</Botao>}
              {t.status !== 'CANCELADO' && t.status !== 'PAGO' && t.pagoCentavos === 0 && (eu.permissoes.includes('pagar.cancelar') || (t.status === 'RASCUNHO' && eu.permissoes.includes('pagar.cancelar_rascunho'))) && <Botao variante="perigo" onClick={() => { setModo('cancelar'); setF({ ...f, motivo: '' }); }}>Cancelar conta</Botao>}
            </div>
          )}
          {modo === 'pagar' && (
            <div className="cartao pilha" style={{ background: 'var(--suave)' }}>
              <h3>Registrar pagamento</h3>
              <div className="linha"><Campo rotulo="Data" type="date" max={hojeIso()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} erro={campos.data} /><CampoDinheiro rotulo="Valor da conta a pagar (R$)" centavos={f.principal} onChange={(v) => setF({ ...f, principal: v })} erro={campos.principalCentavos} dica={`Vazio paga o saldo (${formatarBRL(t.saldoCentavos)}).`} /></div>
              <div className="linha"><CampoDinheiro rotulo="Juros (R$)" centavos={f.juros} onChange={(v) => setF({ ...f, juros: v })} /><CampoDinheiro rotulo="Multa (R$)" centavos={f.multa} onChange={(v) => setF({ ...f, multa: v })} /><CampoDinheiro rotulo="Desconto (R$)" centavos={f.desconto} onChange={(v) => setF({ ...f, desconto: v })} erro={campos.descontoCentavos} /></div>
              {(f.juros || f.multa || f.desconto) ? <Campo rotulo="Motivo (juros, multa ou desconto)" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} erro={campos.motivo} /> : null}
              <Selecao rotulo="Conta de onde saiu" obrigatorio value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })} erro={campos.contaId}><option value="">Escolha…</option>{contas.data?.contas.filter((c) => c.status === 'ATIVO').map((c) => <option key={c.id} value={c.id}>{c.nome} ({formatarBRL(c.saldoCentavos)})</option>)}</Selecao>
              <div className="fld"><label htmlFor="comprovante">Comprovante (opcional)</label><input id="comprovante" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setComp(e.target.files?.[0] ?? null)} /></div>
              <div className="linha"><Botao carregando={pagar.isPending} onClick={() => pagar.mutate()}>Confirmar pagamento</Botao><Botao variante="sec" onClick={() => { setModo(null); setErro(null); }}>Voltar</Botao></div>
            </div>
          )}
          {(modo === 'rejeitar' || modo === 'cancelar' || (modo && typeof modo === 'object')) && (
            <div className="pilha">
              <Campo rotulo="Motivo" obrigatorio value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} dica="Mínimo de 5 caracteres. Fica registrado na auditoria." />
              <div className="linha">
                <Botao variante={modo === 'rejeitar' ? 'sec' : 'perigo'} onClick={() => (modo === 'rejeitar' ? rejeitar.mutate() : modo === 'cancelar' ? cancelar.mutate() : estornar.mutate((modo as { estornar: string }).estornar))}>
                  {modo === 'rejeitar' ? 'Devolver como rascunho' : modo === 'cancelar' ? 'Cancelar conta' : 'Estornar pagamento'}</Botao>
                <Botao variante="sec" onClick={() => { setModo(null); setErro(null); }}>Voltar</Botao>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  );
}

function Recorrencias({ eu, fornecedores, onMudou }: { eu: Eu; fornecedores: Fornecedor[]; onMudou: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const plano = usePlano();
  const lista = useQuery({ queryKey: ['pagar', 'recorrencias', eu.empresaAtivaId], queryFn: () => api.get<Recorrencia[]>('/pagar/recorrencias') });
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ fornecedorId: '', descricao: '', planoContaId: '', valor: null as number | null, frequencia: 'MENSAL' as Recorrencia['frequencia'], dia: '5', inicio: hojeIso(), fim: '' });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const criar = useMutation({
    mutationFn: () => api.post<{ titulosGerados: number }>('/pagar/recorrencias', { fornecedorId: f.fornecedorId || undefined, descricao: f.descricao, planoContaId: f.planoContaId || undefined, valorCentavos: f.valor ?? 0, frequencia: f.frequencia, dia: Number(f.dia), inicio: f.inicio, fim: f.fim || undefined }),
    onSuccess: (r) => { avisar(`Recorrência criada: ${r.titulosGerados} contas geradas.`); setAberto(false); qc.invalidateQueries({ queryKey: ['pagar'] }); onMudou(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  const alternar = useMutation({ mutationFn: (v: { id: string; ativa: boolean }) => api.post(`/pagar/recorrencias/${v.id}/${v.ativa ? 'reativar' : 'pausar'}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['pagar'] }) });
  const semanal = f.frequencia === 'SEMANAL' || f.frequencia === 'QUINZENAL';
  return (
    <div className="cartao pilha">
      <div className="linha entre"><p className="mut">Aluguel, internet, sistemas: o sistema cria a conta de cada período (até 35 dias à frente) e ela segue a aprovação normal.</p>{eu.permissoes.includes('pagar.recorrencia') && <Botao onClick={() => { setAberto(true); setErro(null); setCampos({}); }}>Nova recorrência</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Descrição</th><th>Fornecedor</th><th>Quando</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((r) => (
              <tr key={r.id}><td><b>{r.descricao}</b></td><td>{r.fornecedor ?? '—'}</td><td>{FREQ[r.frequencia]} · {r.frequencia === 'SEMANAL' || r.frequencia === 'QUINZENAL' ? DIAS_SEMANA[r.dia] : `dia ${r.dia}`}{r.fim ? ` até ${dataBr(r.fim)}` : ''}</td><td className="num">{formatarBRL(r.valorCentavos)}</td>
                <td>{r.ativa ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Pausada</Pilula>}</td>
                <td>{eu.permissoes.includes('pagar.recorrencia') && <Botao variante="sec" pequeno onClick={() => alternar.mutate({ id: r.id, ativa: !r.ativa })}>{r.ativa ? 'Pausar' : 'Reativar'}</Botao>}</td></tr>
            ))}
            {lista.data?.length === 0 && <tr><td colSpan={6} className="vazio">Nenhuma despesa recorrente.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Dialogo aberto={aberto} onFechar={() => setAberto(false)} titulo="Nova despesa recorrente">
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Campo rotulo="Descrição" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={campos.descricao} />
          <Selecao rotulo="Fornecedor" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })}><option value="">Sem fornecedor</option>{fornecedores.filter((x) => x.status === 'ATIVO').map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
          <Selecao rotulo="Conta do plano" value={f.planoContaId} onChange={(e) => setF({ ...f, planoContaId: e.target.value })}><option value="">Sem classificação</option>{opcoesPlano(plano.data)}</Selecao>
          <div className="linha">
            <CampoDinheiro rotulo="Valor (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorCentavos} />
            <Selecao rotulo="Frequência" value={f.frequencia} onChange={(e) => setF({ ...f, frequencia: e.target.value as Recorrencia['frequencia'], dia: e.target.value === 'SEMANAL' || e.target.value === 'QUINZENAL' ? '1' : '5' })}>{(Object.keys(FREQ) as (keyof typeof FREQ)[]).map((k) => <option key={k} value={k}>{FREQ[k]}</option>)}</Selecao>
            {semanal ? <Selecao rotulo="Dia da semana" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} erro={campos.dia}>{DIAS_SEMANA.map((n, i) => <option key={n} value={i}>{n}</option>)}</Selecao>
              : <Campo rotulo="Dia do mês" type="number" min={1} max={31} value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} erro={campos.dia} dica="Em mês curto vale o último dia." />}
          </div>
          <div className="linha"><Campo rotulo="Começa em" type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} erro={campos.inicio} /><Campo rotulo="Termina em (opcional)" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} erro={campos.fim} /></div>
          <Botao carregando={criar.isPending} onClick={() => criar.mutate()}>Criar recorrência</Botao>
        </div>
      </Dialogo>
    </div>
  );
}

function Custos({ onMudou }: { onMudou: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [p, setP] = useState(() => { const h = hojeIso(); return { de: h.slice(0, 8) + '01', ate: h }; });
  const [venc, setVenc] = useState('');
  const prev = useQuery({ queryKey: ['pagar', 'custos', p.de, p.ate], enabled: p.ate >= p.de, queryFn: () => api.get<CustoAApurar[]>(`/pagar/custos-a-apurar?de=${p.de}&ate=${p.ate}`) });
  const [erro, setErro] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ titulos: number }>('/pagar/custos-a-apurar', { de: p.de, ate: p.ate, vencimento: venc || undefined }),
    onSuccess: (r) => { avisar(`${plural(r.titulos, 'conta a pagar criada', 'contas a pagar criadas')}.`); setErro(null); qc.invalidateQueries({ queryKey: ['pagar'] }); onMudou(); }, onError: (e) => setErro(mensagemDoErro(e)),
  });
  const total = prev.data?.reduce((s, x) => s + x.totalCentavos, 0) ?? 0;
  return (
    <div className="cartao pilha">
      <p className="mut">Custos dos serviços marcados como "gera conta a pagar" (taxa do Detran, tarifa do sistema de laudo...). Cada custo entra numa conta uma única vez, uma conta por fornecedor.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="linha"><Campo rotulo="Laudos de" type="date" value={p.de} onChange={(e) => setP({ ...p, de: e.target.value })} /><Campo rotulo="até" type="date" max={hojeIso()} value={p.ate} onChange={(e) => setP({ ...p, ate: e.target.value })} /><Campo rotulo="Vencimento das contas" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} dica="Vazio: hoje." /></div>
      {prev.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Fornecedor</th><th className="num">Laudos</th><th className="num">Custos</th><th className="num">Total</th></tr></thead>
          <tbody>
            {prev.data?.map((x) => <tr key={x.fornecedorId}><td>{x.fornecedor}</td><td className="num">{x.laudos}</td><td className="num">{x.custos}</td><td className="num">{formatarBRL(x.totalCentavos)}</td></tr>)}
            {prev.data?.length === 0 && <tr><td colSpan={4} className="vazio">Nada a apurar neste período.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Botao disabled={!prev.data?.length} carregando={m.isPending} onClick={() => m.mutate()}>Criar contas a pagar ({formatarBRL(total)})</Botao>
    </div>
  );
}

function Rateio({ fornecedores, empresas, onMudou }: { fornecedores: Fornecedor[]; empresas: Empresa[]; onMudou: () => void }) {
  const { avisar } = useToast();
  const plano = usePlano();
  const [f, setF] = useState({ fornecedorId: '', descricao: '', planoContaId: '', vencimento: '', valor: null as number | null });
  const [pesos, setPesos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const soma = Object.values(pesos).reduce((s, v) => s + (Number(v.replace(',', '.')) || 0), 0);
  const m = useMutation({
    mutationFn: () => api.post('/pagar/rateios', { fornecedorId: f.fornecedorId || undefined, descricao: f.descricao, planoContaId: f.planoContaId || undefined, vencimento: f.vencimento, valorTotalCentavos: f.valor ?? 0,
      itens: Object.entries(pesos).filter(([, v]) => Number(v.replace(',', '.')) > 0).map(([empresaId, v]) => ({ empresaId, pesoBp: Math.round(Number(v.replace(',', '.')) * 100) })) }),
    onSuccess: () => { avisar('Despesa dividida entre as lojas.'); setErro(null); setCampos({}); setPesos({}); setF({ ...f, descricao: '', valor: null }); onMudou(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  return (
    <div className="cartao pilha">
      <p className="mut">Uma despesa do grupo (ex.: sistema de gestão) dividida entre as lojas. Cada loja recebe a sua conta a pagar, com a sua parte, para aprovar e pagar.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Descrição" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={campos.descricao} />
      <div className="linha">
        <Selecao rotulo="Fornecedor" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })} erro={campos.fornecedorId}><option value="">Escolha…</option>{fornecedores.filter((x) => x.status === 'ATIVO').map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>
        <Selecao rotulo="Conta do plano" value={f.planoContaId} onChange={(e) => setF({ ...f, planoContaId: e.target.value })}><option value="">Sem classificação</option>{opcoesPlano(plano.data)}</Selecao>
        <Campo rotulo="Vencimento" type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} erro={campos.vencimento} />
        <CampoDinheiro rotulo="Valor total (R$)" obrigatorio centavos={f.valor} onChange={(v) => setF({ ...f, valor: v })} erro={campos.valorTotalCentavos} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 700, color: 'var(--verde)', fontSize: 13, marginBottom: 6 }}>Quanto cada loja paga (%)</legend>
        <div className="linha">{empresas.filter((e) => e.status === 'ATIVO').map((e) => <Campo key={e.id} rotulo={e.nomeFantasia} inputMode="decimal" placeholder="0" value={pesos[e.id] ?? ''} onChange={(ev) => setPesos({ ...pesos, [e.id]: ev.target.value })} style={{ width: 120 }} />)}</div>
        <span className={soma === 100 ? 'peq' : 'peq mut'} style={{ color: soma === 100 ? 'var(--verde)' : undefined }}>Soma: {soma.toFixed(2).replace('.', ',')}% {soma === 100 ? '✓' : '(precisa fechar 100%)'}</span>
        {campos.itens && <small style={{ color: 'var(--erro)', display: 'block' }}>{campos.itens}</small>}
      </fieldset>
      <Botao carregando={m.isPending} disabled={soma !== 100} onClick={() => m.mutate()}>Dividir entre as lojas</Botao>
    </div>
  );
}
