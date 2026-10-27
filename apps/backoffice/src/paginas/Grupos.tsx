import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { criarGrupoSchema } from '@ecv/shared';
import type { z } from 'zod';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, formatarDataHora, formatarData, useToast } from '@ecv/ui';
import { api } from '../api';
import { useInterno } from '../sessao';
import type { GrupoItem } from '../tipos';

type Entrada = z.input<typeof criarGrupoSchema>;
export const PILULA_GRUPO = { ATIVO: <Pilula tipo="ok">✓ Ativo</Pilula>, SUSPENSO: <Pilula tipo="erro">! Suspenso</Pilula>, ENCERRADO: <Pilula>Encerrado</Pilula> } as const;

export function Grupos() {
  const { data: eu } = useInterno();
  const lista = useQuery({ queryKey: ['grupos'], queryFn: () => api.get<GrupoItem[]>('/backoffice/grupos') });
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [novo, setNovo] = useState(false);
  const [convite, setConvite] = useState<string | null>(null);
  const { avisar } = useToast();
  const itens = (lista.data ?? []).filter((g) => (!status || g.status === status) && g.nome.toLowerCase().includes(busca.toLowerCase()));
  const ativos = lista.data?.filter((g) => g.status === 'ATIVO').length ?? 0;

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Grupos</h1><p className="mut">{lista.data ? `${lista.data.length} grupos, ${ativos} ativos.` : 'Clientes do ECV Cash.'}</p></div>
        {eu?.permissoes.includes('grupo.criar') && <Botao onClick={() => setNovo(true)}>Novo grupo</Botao>}
      </div>
      <div className="cartao pilha">
        <div className="linha">
          <div style={{ minWidth: 240 }}><Campo rotulo="Buscar" placeholder="Nome do grupo" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <div style={{ minWidth: 180 }}><Selecao rotulo="Situação" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option><option value="ATIVO">Ativos</option><option value="SUSPENSO">Suspensos</option></Selecao></div>
        </div>
        {lista.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Grupo</th><th className="num">Empresas</th><th className="num">Usuários</th><th>Situação</th><th>Último acesso</th><th>Criado em</th><th /></tr></thead>
            <tbody>
              {itens.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.nome}</b></td><td className="num">{g.empresas}</td><td className="num">{g.usuarios}</td><td>{PILULA_GRUPO[g.status]}</td>
                  <td>{formatarDataHora(g.ultimoAcesso)}</td><td>{formatarData(g.criadoEm)}</td>
                  <td><Link className="btn sec peq" to={`/grupos/${g.id}`}>Abrir</Link></td>
                </tr>
              ))}
              {itens.length === 0 && <tr><td colSpan={7} className="vazio">Nenhum grupo encontrado.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      <FormGrupo aberto={novo} onFechar={() => setNovo(false)} onCriado={(link) => { setNovo(false); if (link) setConvite(link); else avisar('Grupo criado.'); }} />
      <Dialogo aberto={!!convite} onFechar={() => setConvite(null)} titulo="Grupo criado">
        <Aviso tipo="ok">Envie este link ao primeiro Administrativo do grupo. Ele define a senha e já entra. Vale por 7 dias e só pode ser usado uma vez.</Aviso>
        <Campo rotulo="Link do convite" readOnly value={convite ?? ''} onFocus={(e) => e.currentTarget.select()} />
        <Botao onClick={async () => { try { await navigator.clipboard.writeText(convite!); avisar('Link copiado.'); } catch { avisar('Selecione o link e copie com Ctrl+C.', 'erro'); } }}>Copiar link</Botao>
      </Dialogo>
    </div>
  );
}

function FormGrupo({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: (link?: string) => void }) {
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Entrada>({
    resolver: zodResolver(criarGrupoSchema) as unknown as Resolver<Entrada>, defaultValues: { empresa: { regimeTributario: 'SIMPLES_NACIONAL' } as Entrada['empresa'] },
  });
  const salvar = useMutation({
    mutationFn: (v: Entrada) => api.post<{ grupoId: string; conviteLink?: string }>('/backoffice/grupos', v),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['grupos'] }); reset(); onCriado(r.conviteLink); },
    onError: (e: Error) => setErro(e.message),
  });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Novo grupo" lateral>
      <form className="pilha" onSubmit={handleSubmit((v) => { setErro(null); salvar.mutate(v); })} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome do grupo" obrigatorio erro={errors.nome?.message} {...register('nome')} />
        <h3>Primeira empresa</h3>
        <Campo rotulo="CNPJ" obrigatorio inputMode="numeric" erro={errors.empresa?.cnpj?.message} {...register('empresa.cnpj')} />
        <Campo rotulo="Razão social" obrigatorio erro={errors.empresa?.razaoSocial?.message} {...register('empresa.razaoSocial')} />
        <Campo rotulo="Nome fantasia" obrigatorio erro={errors.empresa?.nomeFantasia?.message} {...register('empresa.nomeFantasia')} />
        <div className="grade g2"><Campo rotulo="Cidade" obrigatorio erro={errors.empresa?.cidade?.message} {...register('empresa.cidade')} /><Campo rotulo="UF" obrigatorio maxLength={2} erro={errors.empresa?.uf?.message} {...register('empresa.uf')} /></div>
        <Selecao rotulo="Regime tributário" {...register('empresa.regimeTributario')}><option value="SIMPLES_NACIONAL">Simples Nacional</option><option value="LUCRO_PRESUMIDO">Lucro Presumido</option><option value="LUCRO_REAL">Lucro Real</option></Selecao>
        <h3>Primeiro Administrativo</h3>
        <Campo rotulo="Nome" obrigatorio erro={errors.administrativo?.nome?.message} {...register('administrativo.nome')} />
        <Campo rotulo="E-mail" type="email" obrigatorio erro={errors.administrativo?.email?.message} {...register('administrativo.email')} />
        <Botao type="submit" carregando={salvar.isPending}>Criar grupo</Botao>
      </form>
    </Dialogo>
  );
}
