import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { fornecedorSchema, formatarCnpj } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { camposDoErro, checar, mensagemDoErro } from '../formulario';
import type { Eu, Fornecedor, PlanoConta } from '../tipos';

const TIPOS = { FORNECEDOR: 'Fornecedor', PRESTADOR: 'Prestador de serviço', CONCESSIONARIA: 'Concessionária', ORGAO_PUBLICO: 'Órgão público', FRANQUEADOR: 'Franqueador' } as const;
const fmtDoc = (d: string | null) => (!d ? '—' : d.length === 14 ? formatarCnpj(d) : `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`);

export function Fornecedores() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const lista = useQuery({ queryKey: ['fornecedores'], queryFn: () => api.get<Fornecedor[]>('/fornecedores') });
  const plano = useQuery({ queryKey: ['plano'], queryFn: () => api.get<PlanoConta[]>('/plano-contas'), enabled: eu.permissoes.includes('plano_contas.ver') });
  const [dlg, setDlg] = useState<Fornecedor | 'novo' | null>(null);
  const pode = eu.permissoes.includes('fornecedor.editar');
  const conta = (id: string | null) => plano.data?.find((c) => c.id === id);

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Fornecedores</h1><p className="mut">Quem a empresa paga: prestadores, órgãos, concessionárias e o franqueador. Vale para todas as lojas do grupo.</p></div>
        {pode && <Botao onClick={() => setDlg('novo')}>Novo fornecedor</Botao>}
      </div>
      <div className="cartao">{lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Tipo</th><th>E-mail</th><th>Conta padrão</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((f) => (
              <tr key={f.id}><td><b>{f.nome}</b></td><td>{fmtDoc(f.documento)}</td><td><Pilula>{TIPOS[f.tipo]}</Pilula></td><td>{f.email ?? '—'}</td>
                <td>{conta(f.contaPadraoId) ? `${conta(f.contaPadraoId)!.codigo} ${conta(f.contaPadraoId)!.nome}` : '—'}</td>
                <td>{f.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativo</Pilula> : <Pilula>Inativo</Pilula>}</td>
                <td>{pode && <Botao variante="sec" pequeno onClick={() => setDlg(f)}>Editar</Botao>}</td></tr>
            ))}
            {lista.data?.length === 0 && <tr><td colSpan={7} className="vazio">Nenhum fornecedor cadastrado.</td></tr>}
          </tbody>
        </table></div>
      )}</div>
      <Form alvo={dlg} contas={plano.data?.filter((c) => c.aceitaLancamento && c.status === 'ATIVO' && ['DESPESA', 'CUSTO'].includes(c.tipo)) ?? []} onFechar={() => setDlg(null)} />
    </div>
  );
}

function Form({ alvo, contas, onFechar }: { alvo: Fornecedor | 'novo' | null; contas: PlanoConta[]; onFechar: () => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const ed = alvo && alvo !== 'novo' ? alvo : null;
  const [f, setF] = useState({ nome: '', documento: '', tipo: 'FORNECEDOR', email: '', contaPadraoId: '' });
  const [aberto, setAberto] = useState<typeof alvo>(null);
  if (alvo !== aberto) { setAberto(alvo); setF(ed ? { nome: ed.nome, documento: ed.documento ?? '', tipo: ed.tipo, email: ed.email ?? '', contaPadraoId: ed.contaPadraoId ?? '' } : { nome: '', documento: '', tipo: 'FORNECEDOR', email: '', contaPadraoId: '' }); }
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => (ed ? api.patch(`/fornecedores/${ed.id}`, v) : api.post('/fornecedores', v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fornecedores'] }); avisar(ed ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.'); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => {
    setErro(null);
    const r = checar(fornecedorSchema, f);
    if (r.erros) { setErros(r.erros); return; }
    setErros({}); salvar.mutate(r.dados);
  };
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={ed ? `Editar ${ed.nome}` : 'Novo fornecedor'}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome ou razão social" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={erros.nome} />
        <div className="grade g2">
          <Campo rotulo="CPF ou CNPJ" inputMode="numeric" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} erro={erros.documento} dica="Opcional para órgãos públicos." />
          <Selecao rotulo="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selecao>
        </div>
        <Campo rotulo="E-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} erro={erros.email} />
        <Selecao rotulo="Conta padrão do plano" value={f.contaPadraoId} onChange={(e) => setF({ ...f, contaPadraoId: e.target.value })} dica="Já vem preenchida nos próximos pagamentos deste fornecedor.">
          <option value="">Nenhuma</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}
        </Selecao>
        <div className="linha"><Botao carregando={salvar.isPending} onClick={enviar}>{ed ? 'Salvar' : 'Cadastrar fornecedor'}</Botao>
          {ed && <Botao variante="sec" onClick={() => salvar.mutate({ status: ed.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' })}>{ed.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao>}</div>
      </div>
    </Dialogo>
  );
}
