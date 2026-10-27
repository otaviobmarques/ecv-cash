import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { vistoriadorSchema } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { camposDoErro, checar, mensagemDoErro } from '../../formulario';
import type { Empresa, Eu, UsuarioItem, VistoriadorItem } from '../../tipos';

const fmtCpf = (d: string | null) => (d ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : '—');

export function Vistoriadores() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const lista = useQuery({ queryKey: ['vistoriadores'], queryFn: () => api.get<VistoriadorItem[]>('/vistoriadores') });
  const [dlg, setDlg] = useState<VistoriadorItem | 'novo' | null>(null);
  const pode = eu.permissoes.includes('vistoriador.editar');
  const loja = (id: string) => empresas.find((e) => e.id === id)?.nomeFantasia ?? 'Outra loja';
  const lojasDele = eu.rede ? empresas : empresas.filter((e) => eu.empresas.find((x) => x.id === e.id)?.perfil === 'GERENTE');

  return (
    <div className="cartao pilha">
      <div className="cabeca"><p className="mut">Quem faz as vistorias. Um vistoriador pode atuar em mais de uma loja. Para lançar laudos no sistema, ele precisa ter acesso (um usuário com perfil Vistoriador ligado ao cadastro).</p>
        {pode && <Botao onClick={() => setDlg('novo')}>Novo vistoriador</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Nome</th><th>CPF</th><th>Lojas</th><th>Acesso ao sistema</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((v) => (
              <tr key={v.id}><td><b>{v.nome}</b></td><td>{fmtCpf(v.cpf)}</td><td>{v.empresaIds.map(loja).join(', ')}</td>
                <td>{v.usuarioId ? <Pilula tipo="ok">✓ Com acesso</Pilula> : <Pilula tipo="aviso">Sem acesso</Pilula>}</td>
                <td>{v.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativo</Pilula> : <Pilula>Inativo</Pilula>}</td>
                <td>{pode && <Botao variante="sec" pequeno onClick={() => setDlg(v)}>Editar</Botao>}</td></tr>
            ))}
            {lista.data?.length === 0 && <tr><td colSpan={6} className="vazio">Nenhum vistoriador cadastrado.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Form alvo={dlg} lojas={lojasDele} todas={empresas} eu={eu} onFechar={() => setDlg(null)} />
    </div>
  );
}

function Form({ alvo, lojas, todas, eu, onFechar }: { alvo: VistoriadorItem | 'novo' | null; lojas: Empresa[]; todas: Empresa[]; eu: Eu; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ed = alvo && alvo !== 'novo' ? alvo : null;
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get<UsuarioItem[]>('/usuarios'), enabled: !!alvo && !ed && eu.permissoes.includes('usuario.gerir') });
  const [f, setF] = useState({ nome: '', cpf: '', empresaIds: [] as string[], usuarioId: '' });
  const [aberto, setAberto] = useState<typeof alvo>(null);
  if (alvo !== aberto) { setAberto(alvo); setF({ nome: ed?.nome ?? '', cpf: ed?.cpf ?? '', empresaIds: ed?.empresaIds ?? (lojas.length === 1 ? [lojas[0]!.id] : []), usuarioId: '' }); }
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => (ed ? api.patch(`/vistoriadores/${ed.id}`, v) : api.post('/vistoriadores', v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vistoriadores'] }); avisar(ed ? 'Vistoriador atualizado.' : 'Vistoriador cadastrado.'); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => {
    setErro(null);
    if (ed) { if (f.nome.trim().length < 2) { setErros({ nome: 'Informe o nome.' }); return; } if (f.empresaIds.length === 0) { setErros({ empresaIds: 'Escolha ao menos uma loja.' }); return; } salvar.mutate({ nome: f.nome, empresaIds: f.empresaIds }); return; }
    const r = checar(vistoriadorSchema, f); if (r.erros) { setErros(r.erros); return; } setErros({}); salvar.mutate(r.dados);
  };
  const candidatos = usuarios.data?.filter((u) => u.status === 'ATIVO' && u.lotacoes.some((l) => l.perfil === 'VISTORIADOR')) ?? [];
  const marcar = (id: string, on: boolean) => setF({ ...f, empresaIds: on ? [...f.empresaIds, id] : f.empresaIds.filter((x) => x !== id) });
  // lojas onde ele atua mas que este perfil não gerencia aparecem só para leitura
  const outras = ed ? ed.empresaIds.filter((id) => !lojas.some((l) => l.id === id)) : [];
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={ed ? `Editar ${ed.nome}` : 'Novo vistoriador'}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={erros.nome} />
        {!ed && <Campo rotulo="CPF" inputMode="numeric" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} erro={erros.cpf} dica="Opcional." />}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 700, color: 'var(--verde)', fontSize: 13, marginBottom: 6 }}>Lojas em que atua *</legend>
          <div className="pilha" style={{ gap: 8 }}>
            {lojas.map((l) => <label key={l.id} className="check"><input type="checkbox" checked={f.empresaIds.includes(l.id)} onChange={(e) => marcar(l.id, e.target.checked)} />{l.nomeFantasia}</label>)}
            {outras.map((id) => <span key={id} className="peq mut">Também atua em {todas.find((t) => t.id === id)?.nomeFantasia ?? 'outra loja'} (você não gerencia)</span>)}
          </div>
          {erros.empresaIds && <small style={{ color: 'var(--erro)' }}>{erros.empresaIds}</small>}
        </fieldset>
        {!ed && candidatos.length > 0 && <Selecao rotulo="Usuário com acesso ao sistema" value={f.usuarioId} onChange={(e) => setF({ ...f, usuarioId: e.target.value })} dica="Liga este cadastro a quem faz login para lançar laudos."><option value="">Ligar depois</option>{candidatos.map((u) => <option key={u.id} value={u.id}>{u.nome} · {u.email}</option>)}</Selecao>}
        <div className="linha"><Botao carregando={salvar.isPending} onClick={enviar}>{ed ? 'Salvar' : 'Cadastrar vistoriador'}</Botao>
          {ed && <Botao variante="sec" onClick={() => salvar.mutate({ status: ed.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' })}>{ed.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao>}</div>
      </div>
    </Dialogo>
  );
}
