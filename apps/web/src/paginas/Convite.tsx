import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { senhaNova } from '@ecv/shared';
import { Aviso, Botao, Campo, useToast } from '@ecv/ui';
import { api } from '../api';

const schema = z.object({ senha: senhaNova, confirmar: z.string() }).refine((v) => v.senha === v.confirmar, { path: ['confirmar'], message: 'As senhas são diferentes.' });
type Form = z.infer<typeof schema>;

export function Convite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const { avisar } = useToast();
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });

  const enviar = handleSubmit(async (v) => {
    setErro(null);
    try {
      await api.post('/auth/aceitar-convite', { token, senha: v.senha });
      avisar('Senha definida. Entre com o seu e-mail e a nova senha.');
      nav('/login');
    } catch (e) { setErro((e as Error).message); }
  });

  return (
    <div className="centro">
      <form className="cartao" onSubmit={enviar} noValidate>
        <div className="marca" style={{ padding: 0 }}><i>EC</i><span>ECV Cash<small>Confiança que aproxima.</small></span></div>
        <h1 style={{ fontSize: 22, lineHeight: '30px' }}>Crie a sua senha</h1>
        {!token && <Aviso tipo="erro">O link do convite está incompleto. Peça um novo a quem convidou você.</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nova senha" type="password" autoComplete="new-password" dica="Ao menos 10 caracteres, com letras e números." erro={errors.senha?.message} {...register('senha')} />
        <Campo rotulo="Repita a senha" type="password" autoComplete="new-password" erro={errors.confirmar?.message} {...register('confirmar')} />
        <Botao type="submit" carregando={isSubmitting} disabled={!token}>Definir senha</Botao>
      </form>
    </div>
  );
}
