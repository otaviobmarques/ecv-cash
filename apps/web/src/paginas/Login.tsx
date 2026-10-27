import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { loginSchema } from '@ecv/shared';
import type { z } from 'zod';
import { Aviso, Botao, Campo } from '@ecv/ui';
import { api } from '../api';
import { useSessao } from '../sessao';
import type { Eu } from '../tipos';

type Form = z.infer<typeof loginSchema>;

export function Login() {
  const { definir } = useSessao();
  const nav = useNavigate();
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(loginSchema) });

  const enviar = handleSubmit(async (v) => {
    setErro(null);
    try {
      definir(await api.post<Eu>('/auth/login', v));
      nav('/');
    } catch (e) { setErro((e as Error).message); }
  });

  return (
    <div className="centro">
      <form className="cartao" onSubmit={enviar} noValidate>
        <div className="marca" style={{ padding: 0 }}><i>EC</i><span>ECV Cash<small>Confiança que aproxima.</small></span></div>
        <h1 style={{ fontSize: 22, lineHeight: '30px' }}>Entrar</h1>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="E-mail" type="email" autoComplete="username" autoFocus erro={errors.email?.message} {...register('email')} />
        <Campo rotulo="Senha" type="password" autoComplete="current-password" erro={errors.senha?.message} {...register('senha')} />
        <Botao type="submit" carregando={isSubmitting}>Entrar</Botao>
        <p className="peq mut">Não tem acesso ou esqueceu a senha? Fale com o administrativo da sua rede.</p>
      </form>
    </div>
  );
}
