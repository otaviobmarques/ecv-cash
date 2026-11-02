import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

const ICONES = {
  painel: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  empresas: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M4 21h16"/>',
  usuarios: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.4 0 4 1.5 4.5 4.3"/>',
  aparencia: '<path d="M12 3c3 4 6 6.8 6 10.5A6 6 0 0 1 6 13.5C6 9.8 9 7 12 3z"/>',
  auditoria: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  laudo: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/>',
  caixa: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14.5" r="1.6"/>',
  grupos: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
} as const;
export type NomeIcone = keyof typeof ICONES;

export function Icone({ nome }: { nome: NomeIcone }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONES[nome] }} />;
}

export function Botao({ variante = 'primario', pequeno, carregando, children, disabled, ...p }: ComponentProps<'button'> & { variante?: 'primario' | 'sec' | 'perigo'; pequeno?: boolean; carregando?: boolean }) {
  const cls = ['btn', variante === 'primario' ? '' : variante, pequeno ? 'peq' : ''].filter(Boolean).join(' ');
  return <button type="button" {...p} className={cls} disabled={disabled || carregando}>{carregando ? 'Aguarde…' : children}</button>;
}

interface CampoBase { rotulo: string; erro?: string; dica?: string; obrigatorio?: boolean }

export function Campo({ rotulo, erro, dica, obrigatorio, id, ...p }: CampoBase & ComponentProps<'input'>) {
  const gerado = useId();
  const i = id ?? gerado;
  return (
    <div className="fld">
      <label htmlFor={i}>{rotulo}{obrigatorio ? ' *' : ''}</label>
      <input id={i} aria-invalid={!!erro} aria-describedby={erro || dica ? `${i}-m` : undefined} className={erro ? 'bad' : ''} {...p} />
      {erro ? <small className="erro" id={`${i}-m`}>{erro}</small> : dica ? <small id={`${i}-m`}>{dica}</small> : null}
    </div>
  );
}

export function Selecao({ rotulo, erro, dica, obrigatorio, id, children, ...p }: CampoBase & ComponentProps<'select'>) {
  const gerado = useId();
  const i = id ?? gerado;
  return (
    <div className="fld">
      <label htmlFor={i}>{rotulo}{obrigatorio ? ' *' : ''}</label>
      <select id={i} aria-invalid={!!erro} aria-describedby={erro || dica ? `${i}-m` : undefined} className={erro ? 'bad' : ''} {...p}>{children}</select>
      {erro ? <small className="erro" id={`${i}-m`}>{erro}</small> : dica ? <small id={`${i}-m`}>{dica}</small> : null}
    </div>
  );
}

export function AreaTexto({ rotulo, erro, dica, obrigatorio, id, ...p }: CampoBase & ComponentProps<'textarea'>) {
  const gerado = useId();
  const i = id ?? gerado;
  return (
    <div className="fld">
      <label htmlFor={i}>{rotulo}{obrigatorio ? ' *' : ''}</label>
      <textarea id={i} aria-invalid={!!erro} className={erro ? 'bad' : ''} {...p} />
      {erro ? <small className="erro">{erro}</small> : dica ? <small>{dica}</small> : null}
    </div>
  );
}

const SIMBOLO = { ok: '✓', aviso: '!', erro: '!', info: 'i' } as const;
/** Estado nunca só por cor: sempre símbolo e texto. */
export function Aviso({ tipo = 'info', children }: { tipo?: keyof typeof SIMBOLO; children: ReactNode }) {
  return <div className={`msg ${tipo}`} role={tipo === 'erro' ? 'alert' : undefined}><span aria-hidden="true">{SIMBOLO[tipo]}</span><div>{children}</div></div>;
}

export function Pilula({ tipo = 'neutra', children }: { tipo?: 'ok' | 'neutra' | 'aviso' | 'erro' | 'info'; children: ReactNode }) {
  return <span className={`pilula ${tipo}`}>{children}</span>;
}

/** Caixa de diálogo nativa (<dialog>): foco preso, Esc fecha, leitor de tela entende. */
export function Dialogo({ aberto, onFechar, titulo, lateral, children }: { aberto: boolean; onFechar: () => void; titulo: string; lateral?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} className={lateral ? 'lateral' : undefined} onClose={onFechar} onClick={(e) => { if (e.target === ref.current) onFechar(); }} aria-labelledby="dlg-t">
      {aberto && (
        <div className="corpo">
          <div className="linha entre" style={{ alignItems: 'center' }}>
            <h2 id="dlg-t">{titulo}</h2>
            <Botao variante="sec" pequeno onClick={onFechar} aria-label="Fechar">Fechar</Botao>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

interface ToastCtx { avisar: (texto: string, tipo?: 'ok' | 'erro') => void }
const Toasts = createContext<ToastCtx>({ avisar: () => undefined });
export const useToast = () => useContext(Toasts);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<{ id: number; texto: string; tipo: 'ok' | 'erro' }[]>([]);
  const avisar = useCallback((texto: string, tipo: 'ok' | 'erro' = 'ok') => {
    const id = Date.now() + Math.random();
    setItens((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => setItens((l) => l.filter((x) => x.id !== id)), tipo === 'erro' ? 6000 : 3500);
  }, []);
  return (
    <Toasts.Provider value={{ avisar }}>
      {children}
      <div id="toasts" role="status" aria-live="polite">{itens.map((t) => <div key={t.id} className={`toast ${t.tipo === 'erro' ? 'erro' : ''}`}>{t.texto}</div>)}</div>
    </Toasts.Provider>
  );
}

export const Carregando = () => <div className="vazio" role="status">Carregando…</div>;
