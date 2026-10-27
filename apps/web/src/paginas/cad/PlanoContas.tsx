import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { planoContaSchema } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { camposDoErro, checar, mensagemDoErro } from '../../formulario';
import type { Eu, PlanoConta } from '../../tipos';

const TIPOS: Record<string, string> = { RECEITA: 'Receita', DEDUCAO: 'Dedução', CUSTO: 'Custo', DESPESA: 'Despesa', ATIVO: 'Ativo', PASSIVO: 'Passivo', PATRIMONIO: 'Patrimônio' };

export function PlanoContas() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['plano'], queryFn: () => api.get<PlanoConta[]>('/plano-contas') });
  const pode = eu.permissoes.includes('plano_contas.editar');
  const [dlg, setDlg] = useState<{ pai: PlanoConta | null } | { editar: PlanoConta } | null>(null);
  const padroes = useMutation({
    mutationFn: () => api.post('/cadastros/padroes'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plano'] }); qc.invalidateQueries({ queryKey: ['formas'] }); avisar('Plano de contas padrão carregado.'); },
    onError: (e) => avisar(mensagemDoErro(e), 'erro'),
  });
  const alterna = useMutation({
    mutationFn: (c: PlanoConta) => api.patch(`/plano-contas/${c.id}`, { status: c.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plano'] }); avisar('Conta atualizada.'); },
    onError: (e) => avisar(mensagemDoErro(e), 'erro'),
  });
  const nivel = (c: PlanoConta) => c.codigo.split('.').length - 1;

  return (
    <div className="cartao pilha">
      <div className="cabeca"><p className="mut">O plano de contas alimenta o DRE e o balanço. As contas de nível mais alto só agrupam; os lançamentos entram nas subcontas.</p>
        {pode && <Botao onClick={() => setDlg({ pai: null })}>Nova conta</Botao>}</div>
      {lista.isLoading ? <Carregando /> : lista.data?.length === 0 ? (
        <div className="vazio pilha" style={{ alignItems: 'center' }}><p>Este grupo ainda não tem plano de contas.</p>{pode && <Botao carregando={padroes.isPending} onClick={() => padroes.mutate()}>Carregar o plano padrão para ECV</Botao>}</div>
      ) : (
        <div className="tw"><table>
          <thead><tr><th>Código</th><th>Conta</th><th>Tipo</th><th>Aceita lançamento</th><th>Situação</th><th /></tr></thead>
          <tbody>{lista.data?.map((c) => (
            <tr key={c.id}><td>{c.codigo}</td><td style={{ paddingLeft: 12 + nivel(c) * 24, fontWeight: nivel(c) === 0 ? 700 : 400 }}>{c.nome}</td><td><Pilula>{TIPOS[c.tipo]}</Pilula></td>
              <td>{c.aceitaLancamento ? 'Sim' : 'Não, só agrupa'}</td><td>{c.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td>
              <td>{pode && <div className="linha"><Botao variante="sec" pequeno onClick={() => setDlg({ editar: c })}>Editar</Botao><Botao variante="sec" pequeno onClick={() => setDlg({ pai: c })}>Subconta</Botao><Botao variante="sec" pequeno onClick={() => alterna.mutate(c)}>{c.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao></div>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {!pode && <p className="peq mut">Seu perfil consulta o plano de contas. Quem altera é o Administrativo.</p>}
      <Form dlg={dlg} contas={lista.data ?? []} onFechar={() => setDlg(null)} />
    </div>
  );
}

function Form({ dlg, contas, onFechar }: { dlg: { pai: PlanoConta | null } | { editar: PlanoConta } | null; contas: PlanoConta[]; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ed = dlg && 'editar' in dlg ? dlg.editar : null;
  const pai = dlg && 'pai' in dlg ? dlg.pai : null;
  const proximo = () => {
    const filhos = contas.filter((c) => (pai ? c.paiId === pai.id : c.paiId === null)).map((c) => Number(c.codigo.split('.').pop()));
    const n = (filhos.length ? Math.max(...filhos) : 0) + 1;
    return pai ? `${pai.codigo}.${n}` : String(n);
  };
  const [f, setF] = useState({ codigo: '', nome: '', tipo: 'DESPESA', aceitaLancamento: true });
  const [aberto, setAberto] = useState<typeof dlg>(null);
  if (dlg !== aberto) { setAberto(dlg); setF(ed ? { codigo: ed.codigo, nome: ed.nome, tipo: ed.tipo, aceitaLancamento: ed.aceitaLancamento } : { codigo: dlg ? proximo() : '', nome: '', tipo: pai?.tipo ?? 'DESPESA', aceitaLancamento: true }); }
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => (ed ? api.patch(`/plano-contas/${ed.id}`, v) : api.post('/plano-contas', v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plano'] }); avisar(ed ? 'Conta atualizada.' : 'Conta criada.'); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => {
    setErro(null);
    if (ed) { if (f.nome.trim().length < 2) { setErros({ nome: 'Informe o nome.' }); return; } salvar.mutate({ nome: f.nome, aceitaLancamento: f.aceitaLancamento }); return; }
    const r = checar(planoContaSchema, f); if (r.erros) { setErros(r.erros); return; } setErros({}); salvar.mutate(r.dados);
  };
  return (
    <Dialogo aberto={!!dlg} onFechar={onFechar} titulo={ed ? `Editar ${ed.codigo} ${ed.nome}` : pai ? `Subconta de ${pai.codigo} ${pai.nome}` : 'Nova conta'}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Código" obrigatorio disabled={!!ed} value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} erro={erros.codigo} dica="Números separados por ponto. A conta pai precisa existir." />
        <Campo rotulo="Nome" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={erros.nome} />
        <Selecao rotulo="Tipo" disabled={!!ed || !!pai} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} dica={pai ? 'A subconta herda o tipo da conta pai.' : undefined}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selecao>
        <label className="check"><input type="checkbox" checked={f.aceitaLancamento} onChange={(e) => setF({ ...f, aceitaLancamento: e.target.checked })} />Aceita lançamentos (desmarque se só agrupa subcontas)</label>
        <Botao carregando={salvar.isPending} onClick={enviar}>{ed ? 'Salvar' : 'Criar conta'}</Botao>
      </div>
    </Dialogo>
  );
}
