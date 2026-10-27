import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatarBRL, servicoCustoSchema, servicoSchema } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { CampoDinheiro, CampoPercentual, camposDoErro, checar, mensagemDoErro, pct } from '../../formulario';
import type { Custo, Eu, Fornecedor, PlanoConta, Servico } from '../../tipos';

export function Servicos() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['servicos'], queryFn: () => api.get<Servico[]>('/servicos') });
  const plano = useQuery({ queryKey: ['plano'], queryFn: () => api.get<PlanoConta[]>('/plano-contas'), enabled: eu.permissoes.includes('plano_contas.ver') });
  const forn = useQuery({ queryKey: ['fornecedores'], queryFn: () => api.get<Fornecedor[]>('/fornecedores'), enabled: eu.permissoes.includes('custo_servico.editar') });
  const [srv, setSrv] = useState<Servico | 'novo' | null>(null);
  const [custo, setCusto] = useState<{ servico: Servico; custo: Custo | null } | null>(null);
  const edita = eu.permissoes.includes('servico.editar');
  const veCustos = eu.permissoes.includes('custo_servico.ver');
  const completo = edita || veCustos;
  const { avisar } = useToast();
  const alterna = useMutation({
    mutationFn: (s: Servico) => api.patch(`/servicos/${s.id}`, { status: s.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['servicos'] }); avisar('Serviço atualizado.'); },
    onError: (e) => avisar(mensagemDoErro(e), 'erro'),
  });
  const fmtCusto = (c: Custo) => `${c.descricao}: ${c.tipo === 'VALOR' ? formatarBRL(c.valorCentavos ?? 0) : pct(c.percentualBp)}${c.geraContaPagar ? ' · gera conta a pagar' : ''}`;

  return (
    <div className="cartao pilha">
      <div className="cabeca"><p className="mut">Cada serviço tem uma conta de receita e custos diretos por laudo (taxa do Detran, tarifa do sistema de laudo). O preço de cada cliente fica em “Clientes e preços”.</p>
        {edita && <Botao onClick={() => setSrv('novo')}>Novo serviço</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Serviço</th>{completo && <th>Código</th>}{completo && <th>Conta de receita</th>}{veCustos && <th>Custos diretos por laudo</th>}{completo && <th>Situação</th>}<th /></tr></thead>
          <tbody>
            {lista.data?.map((s) => (
              <tr key={s.id}><td><b>{s.nome}</b></td>{completo && <td>{s.codigo ?? '—'}</td>}{completo && <td>{s.contaReceita ?? <span className="mut">—</span>}</td>}
                {veCustos && <td>{s.custos?.filter((c) => c.status === 'ATIVO').map((c) => (
                  <div key={c.id}>{fmtCusto(c)} {edita && <button type="button" className="btn sec peq" style={{ minHeight: 24, padding: '0 8px' }} onClick={() => setCusto({ servico: s, custo: c })}>editar</button>}</div>
                )) ?? null}{s.custos?.filter((c) => c.status === 'ATIVO').length === 0 && <span className="mut">Nenhum</span>}</td>}
                {completo && <td>{s.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativo</Pilula> : <Pilula>Inativo</Pilula>}</td>}
                <td>{edita && <div className="linha"><Botao variante="sec" pequeno onClick={() => setSrv(s)}>Editar</Botao><Botao variante="sec" pequeno onClick={() => setCusto({ servico: s, custo: null })}>Novo custo</Botao><Botao variante="sec" pequeno onClick={() => alterna.mutate(s)}>{s.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao></div>}</td></tr>
            ))}
            {lista.data?.length === 0 && <tr><td colSpan={6} className="vazio">Nenhum serviço cadastrado ainda.</td></tr>}
          </tbody>
        </table></div>
      )}
      {!edita && <p className="peq mut">Seu perfil consulta os serviços. Quem cadastra é o Administrativo.</p>}
      <FormServico alvo={srv} contas={plano.data?.filter((c) => c.tipo === 'RECEITA' && c.aceitaLancamento && c.status === 'ATIVO') ?? []} onFechar={() => setSrv(null)} />
      <FormCusto alvo={custo} fornecedores={forn.data?.filter((f) => f.status === 'ATIVO') ?? []} onFechar={() => setCusto(null)} />
    </div>
  );
}

function FormServico({ alvo, contas, onFechar }: { alvo: Servico | 'novo' | null; contas: PlanoConta[]; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ed = alvo && alvo !== 'novo' ? alvo : null;
  const [f, setF] = useState({ nome: '', codigo: '', contaReceitaId: '' });
  const [aberto, setAberto] = useState<typeof alvo>(null);
  if (alvo !== aberto) { setAberto(alvo); setF({ nome: ed?.nome ?? '', codigo: ed?.codigo ?? '', contaReceitaId: ed?.contaReceitaId ?? '' }); }
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => (ed ? api.patch(`/servicos/${ed.id}`, v) : api.post('/servicos', v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['servicos'] }); avisar(ed ? 'Serviço atualizado.' : 'Serviço cadastrado.'); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => { setErro(null); const r = checar(servicoSchema, f); if (r.erros) { setErros(r.erros); return; } setErros({}); salvar.mutate(r.dados); };
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={ed ? `Editar ${ed.nome}` : 'Novo serviço'}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome do serviço" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={erros.nome} />
        <Campo rotulo="Código" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} dica="Opcional. Ex.: CAU, TRF." />
        <Selecao rotulo="Conta de receita" value={f.contaReceitaId} onChange={(e) => setF({ ...f, contaReceitaId: e.target.value })} dica="Onde esta receita aparece no DRE.">
          <option value="">Escolher depois</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}
        </Selecao>
        <Botao carregando={salvar.isPending} onClick={enviar}>{ed ? 'Salvar' : 'Cadastrar serviço'}</Botao>
      </div>
    </Dialogo>
  );
}

function FormCusto({ alvo, fornecedores, onFechar }: { alvo: { servico: Servico; custo: Custo | null } | null; fornecedores: Fornecedor[]; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ed = alvo?.custo ?? null;
  const [f, setF] = useState<{ descricao: string; tipo: 'VALOR' | 'PERCENTUAL'; valorCentavos: number | null; percentualBp: number | null; geraContaPagar: boolean; fornecedorId: string }>({ descricao: '', tipo: 'VALOR', valorCentavos: null, percentualBp: null, geraContaPagar: false, fornecedorId: '' });
  const [aberto, setAberto] = useState<typeof alvo>(null);
  const [chave, setChave] = useState(0);
  if (alvo !== aberto) { setAberto(alvo); setChave((k) => k + 1); setF({ descricao: ed?.descricao ?? '', tipo: ed?.tipo ?? 'VALOR', valorCentavos: ed?.valorCentavos ?? null, percentualBp: ed?.percentualBp ?? null, geraContaPagar: ed?.geraContaPagar ?? false, fornecedorId: ed?.fornecedorId ?? '' }); }
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => (ed ? api.patch(`/servicos/${alvo!.servico.id}/custos/${ed.id}`, v) : api.post(`/servicos/${alvo!.servico.id}/custos`, v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['servicos'] }); avisar('Custo salvo.'); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = (extra: object = {}) => { setErro(null); const r = checar(servicoCustoSchema, { ...f, fornecedorId: f.fornecedorId }); if (r.erros) { setErros(r.erros); return; } setErros({}); salvar.mutate({ ...r.dados, ...extra }); };
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={`${ed ? 'Editar custo' : 'Novo custo'} de ${alvo?.servico.nome ?? ''}`}>
      <div className="pilha" key={chave}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Descrição" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={erros.descricao} dica="Ex.: Taxa do Detran, tarifa do sistema de laudo." />
        <Selecao rotulo="Como é cobrado" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as 'VALOR' | 'PERCENTUAL' })}><option value="VALOR">Valor fixo por laudo</option><option value="PERCENTUAL">Percentual do valor cobrado</option></Selecao>
        {f.tipo === 'VALOR' ? <CampoDinheiro rotulo="Valor por laudo (R$)" obrigatorio centavos={f.valorCentavos} onChange={(c) => setF({ ...f, valorCentavos: c })} erro={erros.valorCentavos} />
          : <CampoPercentual rotulo="Percentual do valor cobrado (%)" obrigatorio bp={f.percentualBp} onChange={(b) => setF({ ...f, percentualBp: b })} erro={erros.percentualBp} />}
        <label className="check"><input type="checkbox" checked={f.geraContaPagar} onChange={(e) => setF({ ...f, geraContaPagar: e.target.checked })} />Gera conta a pagar (o custo é repassado a um fornecedor)</label>
        {f.geraContaPagar && <Selecao rotulo="Fornecedor" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })}><option value="">Escolher depois</option>{fornecedores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Selecao>}
        <Aviso>O custo entra na margem de cada laudo, gravado no momento do lançamento. Mudar o custo depois não altera laudos já lançados.</Aviso>
        <div className="linha"><Botao carregando={salvar.isPending} onClick={() => enviar()}>Salvar custo</Botao>
          {ed && <Botao variante="perigo" onClick={() => enviar({ status: 'INATIVO' })}>Inativar custo</Botao>}</div>
      </div>
    </Dialogo>
  );
}
