import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Aviso, Carregando } from '@ecv/ui';
import { api } from '../api';
import { useSessao } from '../sessao';
import type { Eu } from '../tipos';

/** O ticket é de uso único: a troca roda uma só vez, mesmo com o modo estrito do React em desenvolvimento. */
let troca: Promise<Eu> | null = null;

export function Suporte() {
  const { definir } = useSessao();
  const nav = useNavigate();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    if (!ticket) { setErro('O link de suporte está incompleto.'); return; }
    troca ??= api.post<Eu>('/auth/suporte', { ticket });
    troca.then((eu) => { history.replaceState(null, '', '/suporte'); definir(eu); nav('/', { replace: true }); })
      .catch((e: Error) => setErro(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="centro"><div className="cartao">
      {erro ? <Aviso tipo="erro">{erro} Peça um novo acesso no backoffice.</Aviso> : <Carregando />}
    </div></div>
  );
}
