import { useState } from 'react';
import { formatarBRL, paraCentavos, percentualParaBp } from '@ecv/shared';
import { Campo } from './componentes';

/** Dinheiro digitado em reais ("1.234,56") que vira centavos inteiros. */
export function CampoDinheiro({ rotulo, centavos, onChange, erro, dica, obrigatorio }: { rotulo: string; centavos: number | null; onChange: (c: number | null) => void; erro?: string; dica?: string; obrigatorio?: boolean }) {
  const [texto, setTexto] = useState(centavos == null ? '' : formatarBRL(centavos).replace('R$ ', ''));
  return (
    <Campo rotulo={rotulo} inputMode="decimal" placeholder="0,00" value={texto} erro={erro} dica={dica} obrigatorio={obrigatorio}
      onChange={(e) => { setTexto(e.target.value); onChange(e.target.value.trim() === '' ? null : paraCentavos(e.target.value)); }}
      onBlur={() => { const c = paraCentavos(texto); if (c !== null) setTexto(formatarBRL(c).replace('R$ ', '')); }} />
  );
}

/** Percentual digitado ("2,00") que vira pontos-base (200). */
export function CampoPercentual({ rotulo, bp, onChange, erro, dica, obrigatorio }: { rotulo: string; bp: number | null; onChange: (b: number | null) => void; erro?: string; dica?: string; obrigatorio?: boolean }) {
  const [texto, setTexto] = useState(bp == null ? '' : (bp / 100).toFixed(2).replace('.', ','));
  return (
    <Campo rotulo={rotulo} inputMode="decimal" placeholder="0,00" value={texto} erro={erro} dica={dica} obrigatorio={obrigatorio}
      onChange={(e) => { setTexto(e.target.value); onChange(e.target.value.trim() === '' ? null : percentualParaBp(e.target.value)); }} />
  );
}
