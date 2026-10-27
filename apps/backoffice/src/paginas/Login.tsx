import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { Aviso, Botao, Campo } from '@ecv/ui';
import { api } from '../api';
import { useInterno, useSessaoInterna } from '../sessao';
import type { Interno } from '../tipos';

type Passo = { etapa: 'MFA' | 'CONFIGURAR_MFA'; ticket: string; segredo?: string; uri?: string };

function Qr({ texto }: { texto: string }) {
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }, [texto]);
  return <div className="qr" role="img" aria-label="QR Code para o aplicativo autenticador" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Login() {
  const { data: eu } = useInterno();
  const { definir } = useSessaoInterna();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [passo, setPasso] = useState<Passo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(null); setOcupado(true);
    try {
      if (!passo) setPasso(await api.post<Passo>('/backoffice/auth/login', { email, senha }));
      else { definir(await api.post<Interno>('/backoffice/auth/mfa', { ticket: passo.ticket, codigo })); nav('/'); }
    } catch (x) {
      setErro((x as Error).message);
      if (passo && (x as { status?: number }).status === 401 && /expirou/i.test((x as Error).message)) { setPasso(null); setSenha(''); }
    } finally { setOcupado(false); setCodigo(''); }
  };

  if (eu) return <Navigate to="/" replace />;

  return (
    <div className="centro">
      <form className="cartao" onSubmit={enviar} noValidate>
        <div className="marca" style={{ padding: 0 }}><i>EC</i><span>ECV Cash<small>Backoffice</small></span></div>
        <h1 style={{ fontSize: 22, lineHeight: '30px' }}>{passo ? (passo.etapa === 'CONFIGURAR_MFA' ? 'Configure o autenticador' : 'Verificação em duas etapas') : 'Entrar'}</h1>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!passo ? (
          <>
            <Campo rotulo="E-mail" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <Campo rotulo="Senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </>
        ) : (
          <>
            {passo.etapa === 'CONFIGURAR_MFA' && passo.uri && passo.segredo && (
              <>
                <Aviso>No primeiro acesso é preciso ligar um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password ou similar). Leia o QR Code e digite o código de 6 números que aparecer.</Aviso>
                <div className="linha" style={{ alignItems: 'center' }}>
                  <Qr texto={passo.uri} />
                  <div className="peq"><div className="mut">Não consegue ler o QR? Digite este código no aplicativo:</div><code style={{ wordBreak: 'break-all', fontSize: 13 }}>{passo.segredo}</code></div>
                </div>
              </>
            )}
            <Campo rotulo="Código do aplicativo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} dica="6 números. Cada código vale uma vez só." />
          </>
        )}
        <Botao type="submit" carregando={ocupado} disabled={passo ? codigo.length !== 6 : !email || !senha}>{passo ? 'Confirmar' : 'Continuar'}</Botao>
        {passo && <Botao variante="sec" onClick={() => { setPasso(null); setErro(null); }}>Voltar</Botao>}
      </form>
    </div>
  );
}
