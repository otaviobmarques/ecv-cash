import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { ROTULO_PERFIL, criarUsuarioSchema, type Perfil } from '@ecv/shared';
import type { z } from 'zod';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import type { Empresa, Eu, UsuarioItem } from '../tipos';

type Entrada = z.input<typeof criarUsuarioSchema>;

export function Usuarios() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const qc = useQueryClient();
  const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get<UsuarioItem[]>('/usuarios') });
  const [novo, setNovo] = useState(false);
  const [convite, setConvite] = useState<{ nome: string; link: string } | null>(null);
  const [alvo, setAlvo] = useState<UsuarioItem | null>(null);
  const nomeLoja = (id: string) => empresas.find((e) => e.id === id)?.nomeFantasia ?? 'Loja';

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Usuários</h1><p className="mut">{eu.rede ? 'Todas as pessoas do grupo.' : 'As pessoas das suas lojas. Você cria Financeiro e Vistoriador.'}</p></div>
        <Botao onClick={() => setNovo(true)}>Novo usuário</Botao>
      </div>
      <div className="cartao">
        {lista.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.data?.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.nome}</b></td><td>{u.email}</td>
                  <td>{u.acessoRede ? <Pilula tipo="info">Administrativo · todas as lojas</Pilula> : u.lotacoes.map((l) => <div key={l.empresaId}><Pilula>{ROTULO_PERFIL[l.perfil]}</Pilula> <span className="peq mut">{nomeLoja(l.empresaId)}</span></div>)}</td>
                  <td>{u.status === 'INATIVO' ? <Pilula tipo="erro">! Inativo</Pilula> : u.convitePendente ? <Pilula tipo="aviso">◔ Convite pendente</Pilula> : <Pilula tipo="ok">✓ Ativo</Pilula>}</td>
                  <td>{eu.rede && u.id !== eu.id && <Botao variante={u.status === 'ATIVO' ? 'perigo' : 'sec'} pequeno onClick={() => setAlvo(u)}>{u.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <FormNovo aberto={novo} eu={eu} empresas={empresas} onFechar={() => setNovo(false)}
        onCriado={(nome, link) => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setNovo(false); if (link) setConvite({ nome, link }); else avisar('Usuário criado. O convite foi enviado.'); }} />
      <Dialogo aberto={!!convite} onFechar={() => setConvite(null)} titulo="Convite criado">
        <Aviso tipo="ok">{convite?.nome} já pode ser convidado(a). O envio automático por e-mail ainda não está ativo: copie o link abaixo e envie por um canal seguro. Ele vale por 7 dias e só pode ser usado uma vez.</Aviso>
        <Campo rotulo="Link do convite" readOnly value={convite?.link ?? ''} onFocus={(e) => e.currentTarget.select()} />
        <Botao onClick={async () => { try { await navigator.clipboard.writeText(convite!.link); avisar('Link copiado.'); } catch { avisar('Selecione o link e copie com Ctrl+C.', 'erro'); } }}>Copiar link</Botao>
      </Dialogo>
      <FormStatus alvo={alvo} onFechar={() => setAlvo(null)} />
    </div>
  );
}

function FormNovo({ aberto, eu, empresas, onFechar, onCriado }: { aberto: boolean; eu: Eu; empresas: Empresa[]; onFechar: () => void; onCriado: (nome: string, link?: string) => void }) {
  const perfis: Perfil[] = eu.rede ? ['ADMINISTRATIVO', 'GERENTE', 'FINANCEIRO', 'VISTORIADOR'] : ['FINANCEIRO', 'VISTORIADOR'];
  const lojas = eu.rede ? empresas : empresas.filter((e) => eu.empresas.find((x) => x.id === e.id)?.perfil === 'GERENTE');
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<Entrada>({
    resolver: zodResolver(criarUsuarioSchema) as unknown as Resolver<Entrada>, defaultValues: { perfil: perfis[perfis.length - 1], empresaIds: [] },
  });
  const perfil = watch('perfil');
  const salvar = useMutation({
    mutationFn: (v: Entrada) => api.post<{ id: string; conviteLink?: string }>('/usuarios', v),
    onSuccess: (r, v) => { reset(); onCriado(v.nome, r.conviteLink); },
    onError: (e: Error) => setErro(e.message),
  });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Novo usuário">
      <form className="pilha" onSubmit={handleSubmit((v) => { setErro(null); salvar.mutate(v); })} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" obrigatorio erro={errors.nome?.message} {...register('nome')} />
        <Campo rotulo="E-mail" type="email" obrigatorio erro={errors.email?.message} {...register('email')} />
        <Selecao rotulo="Perfil" obrigatorio erro={errors.perfil?.message} {...register('perfil')}>
          {perfis.map((p) => <option key={p} value={p}>{ROTULO_PERFIL[p]}</option>)}
        </Selecao>
        {perfil !== 'ADMINISTRATIVO' && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, color: 'var(--verde)', fontSize: 13, marginBottom: 6 }}>Lojas *</legend>
            <div className="pilha" style={{ gap: 8 }}>
              {lojas.map((e) => <label key={e.id} className="check"><input type="checkbox" value={e.id} {...register('empresaIds')} />{e.nomeFantasia}</label>)}
            </div>
            {errors.empresaIds?.message && <small className="erro" style={{ color: 'var(--erro)' }}>{errors.empresaIds.message}</small>}
          </fieldset>
        )}
        {perfil === 'ADMINISTRATIVO' && <Aviso>O Administrativo enxerga todas as lojas do grupo.</Aviso>}
        <Botao type="submit" carregando={salvar.isPending}>Criar e gerar convite</Botao>
      </form>
    </Dialogo>
  );
}

function FormStatus({ alvo, onFechar }: { alvo: UsuarioItem | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const novo = alvo?.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
  const salvar = useMutation({
    mutationFn: () => api.patch(`/usuarios/${alvo!.id}/status`, { status: novo, motivo: motivo || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); avisar(novo === 'INATIVO' ? 'Usuário inativado. O acesso foi cortado.' : 'Usuário reativado.'); setMotivo(''); onFechar(); },
    onError: (e: Error) => setErro(e.message),
  });
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={`${novo === 'INATIVO' ? 'Inativar' : 'Reativar'} ${alvo?.nome ?? ''}`}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {novo === 'INATIVO' && <Aviso tipo="aviso">A pessoa perde o acesso agora, mesmo com o sistema aberto. O histórico dela continua no log.</Aviso>}
      <AreaTexto rotulo="Motivo" dica="Fica registrado na auditoria. Mínimo de 5 caracteres." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Botao variante={novo === 'INATIVO' ? 'perigo' : 'primario'} carregando={salvar.isPending} disabled={motivo.trim().length < 5} onClick={() => { setErro(null); salvar.mutate(); }}>
        {novo === 'INATIVO' ? 'Inativar usuário' : 'Reativar usuário'}
      </Botao>
    </Dialogo>
  );
}
