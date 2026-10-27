import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { criarEmpresaSchema, formatarCnpj } from '@ecv/shared';
import type { z } from 'zod';
import { Aviso, Botao, Campo, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import { ROTULO_REGIME, type Empresa, type Eu } from '../tipos';

type Entrada = z.input<typeof criarEmpresaSchema>;

export function Empresas() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<Empresa | null>(null);
  const podeCriar = eu.permissoes.includes('empresa.criar');
  const podeEditar = (e: Empresa) => eu.rede || eu.empresas.find((x) => x.id === e.id)?.perfil === 'GERENTE';

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Empresas</h1><p className="mut">As lojas (CNPJs) do seu grupo{eu.rede ? '' : ' a que você tem acesso'}.</p></div>
        {podeCriar && <Botao onClick={() => setNovo(true)}>Nova empresa</Botao>}
      </div>
      <div className="cartao"><div className="tw">
        <table>
          <thead><tr><th>Empresa</th><th>CNPJ</th><th>Cidade</th><th>Regime</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id}>
                <td><b>{e.nomeFantasia}</b><div className="mut peq">{e.razaoSocial}</div></td>
                <td>{formatarCnpj(e.cnpj)}</td><td>{e.cidade}/{e.uf}</td><td>{ROTULO_REGIME[e.regime]}</td>
                <td>{e.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td>
                <td>{podeEditar(e) && <Botao variante="sec" pequeno onClick={() => setEditando(e)}>Editar</Botao>}</td>
              </tr>
            ))}
            {empresas.length === 0 && <tr><td colSpan={6} className="vazio">Nenhuma empresa para mostrar.</td></tr>}
          </tbody>
        </table>
      </div></div>
      <FormNova aberto={novo} onFechar={() => setNovo(false)} />
      <FormEditar empresa={editando} onFechar={() => setEditando(null)} />
    </div>
  );
}

function FormNova({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<Entrada>({
    resolver: zodResolver(criarEmpresaSchema) as unknown as Resolver<Entrada>, defaultValues: { regimeTributario: 'SIMPLES_NACIONAL' },
  });
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: Entrada) => api.post('/empresas', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['empresas'] }); avisar('Empresa cadastrada.'); reset(); onFechar(); },
    onError: (e: Error & { campos?: Record<string, string> }) => {
      setErro(e.message);
      Object.entries(e.campos ?? {}).forEach(([k, m]) => setError(k as keyof Entrada, { message: m }));
    },
  });
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Nova empresa">
      <form className="pilha" onSubmit={handleSubmit((v) => { setErro(null); salvar.mutate(v); })} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="CNPJ" obrigatorio inputMode="numeric" placeholder="00.000.000/0000-00" erro={errors.cnpj?.message} {...register('cnpj')} />
        <Campo rotulo="Razão social" obrigatorio erro={errors.razaoSocial?.message} {...register('razaoSocial')} />
        <Campo rotulo="Nome fantasia" obrigatorio erro={errors.nomeFantasia?.message} {...register('nomeFantasia')} />
        <div className="grade g2"><Campo rotulo="Cidade" obrigatorio erro={errors.cidade?.message} {...register('cidade')} /><Campo rotulo="UF" obrigatorio maxLength={2} erro={errors.uf?.message} {...register('uf')} /></div>
        <Selecao rotulo="Regime tributário" erro={errors.regimeTributario?.message} {...register('regimeTributario')}>
          {Object.entries(ROTULO_REGIME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selecao>
        <Campo rotulo="E-mail do financeiro" type="email" dica="Usado nas faturas e nos avisos." erro={errors.emailFinanceiro?.message} {...register('emailFinanceiro')} />
        <Botao type="submit" carregando={salvar.isPending}>Cadastrar empresa</Botao>
      </form>
    </Dialogo>
  );
}

function FormEditar({ empresa, onFechar }: { empresa: Empresa | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<{ nomeFantasia: string; cidade: string; uf: string; emailFinanceiro: string }>({
    values: empresa ? { nomeFantasia: empresa.nomeFantasia, cidade: empresa.cidade, uf: empresa.uf, emailFinanceiro: empresa.emailFinanceiro ?? '' } : undefined,
  });
  const salvar = useMutation({
    mutationFn: (v: { nomeFantasia: string; cidade: string; uf: string; emailFinanceiro: string }) =>
      api.patch(`/empresas/${empresa!.id}`, { ...v, emailFinanceiro: v.emailFinanceiro || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['empresas'] }); avisar('Empresa atualizada.'); onFechar(); },
    onError: (e: Error) => setErro(e.message),
  });
  return (
    <Dialogo aberto={!!empresa} onFechar={onFechar} titulo={`Editar ${empresa?.nomeFantasia ?? ''}`}>
      <form className="pilha" onSubmit={handleSubmit((v) => { setErro(null); salvar.mutate(v); })} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome fantasia" {...register('nomeFantasia')} />
        <div className="grade g2"><Campo rotulo="Cidade" {...register('cidade')} /><Campo rotulo="UF" maxLength={2} {...register('uf')} /></div>
        <Campo rotulo="E-mail do financeiro" type="email" {...register('emailFinanceiro')} />
        <p className="peq mut">CNPJ, razão social e regime não mudam por aqui. Fale com o administrativo da rede.</p>
        <Botao type="submit" carregando={salvar.isPending}>Salvar</Botao>
      </form>
    </Dialogo>
  );
}
