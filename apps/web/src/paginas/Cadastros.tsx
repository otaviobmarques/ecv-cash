import { useSearchParams, useOutletContext } from 'react-router-dom';
import type { Eu } from '../tipos';
import { Servicos } from './cad/Servicos';
import { Vistoriadores } from './cad/Vistoriadores';
import { Formas } from './cad/Formas';
import { Contas } from './cad/Contas';
import { PlanoContas } from './cad/PlanoContas';

const ABAS = [
  { id: 'servicos', rotulo: 'Serviços', perm: 'servico.ver' },
  { id: 'vistoriadores', rotulo: 'Vistoriadores', perm: 'vistoriador.ver' },
  { id: 'formas', rotulo: 'Formas de pagamento', perm: 'forma_pagamento.ver' },
  { id: 'contas', rotulo: 'Contas bancárias', perm: 'conta_financeira.ver' },
  { id: 'plano', rotulo: 'Plano de contas', perm: 'plano_contas.ver' },
] as const;

export function Cadastros() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const [p, setP] = useSearchParams();
  const abas = ABAS.filter((a) => eu.permissoes.includes(a.perm));
  const atual = abas.find((a) => a.id === p.get('aba'))?.id ?? abas[0]?.id;
  return (
    <div className="pilha">
      <div className="cabeca"><div><h1>Cadastros</h1><p className="mut">A base de tudo o que é lançado: serviços, pessoas, formas de pagamento, contas e plano de contas.</p></div></div>
      <div className="tabs" role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--borda)', flexWrap: 'wrap' }}>
        {abas.map((a) => (
          <button key={a.id} role="tab" aria-selected={atual === a.id} onClick={() => setP({ aba: a.id })}
            style={{ background: 'none', border: 0, padding: '12px 16px', fontWeight: 700, color: atual === a.id ? 'var(--verde)' : 'var(--texto-2)', cursor: 'pointer', borderBottom: `3px solid ${atual === a.id ? 'var(--brand)' : 'transparent'}`, marginBottom: -1.5 }}>{a.rotulo}</button>
        ))}
      </div>
      {atual === 'servicos' && <Servicos />}
      {atual === 'vistoriadores' && <Vistoriadores />}
      {atual === 'formas' && <Formas />}
      {atual === 'contas' && <Contas />}
      {atual === 'plano' && <PlanoContas />}
    </div>
  );
}
