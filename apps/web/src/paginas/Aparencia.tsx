import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { derivarTema, ehHex } from '@ecv/shared';
import { Aviso, Botao, Campo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../api';
import type { Empresa, Eu, TemaEfetivo } from '../tipos';

export function Aparencia() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const qc = useQueryClient();
  const { avisar } = useToast();
  const atual = useQuery({ queryKey: ['tema', eu.empresaAtivaId], queryFn: () => api.get<TemaEfetivo | Record<string, never>>('/tema') });
  const [escopo, setEscopo] = useState<'GRUPO' | 'EMPRESA'>(eu.rede ? 'GRUPO' : 'EMPRESA');
  const [cor, setCor] = useState('#104B3A');
  const [erro, setErro] = useState<string | null>(null);
  const [erroCor, setErroCor] = useState<string | null>(null);
  const t = atual.data as TemaEfetivo | undefined;
  useEffect(() => { if (t && 'corPrimaria' in t) setCor(t.corPrimaria); }, [t]);

  const valida = ehHex(cor);
  const d = valida ? derivarTema(cor) : null;
  const ativa = empresas.find((e) => e.id === eu.empresaAtivaId);
  const salvar = useMutation({
    mutationFn: () => api.put('/tema', { escopo, empresaId: escopo === 'EMPRESA' ? eu.empresaAtivaId : undefined, corPrimaria: cor.toUpperCase() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tema'] }); avisar('Cor salva. Relatórios e faturas passam a usar a nova identidade.'); },
    onError: (e: Error & { campos?: Record<string, string> }) => { setErro(e.message); setErroCor(e.campos?.corPrimaria ?? null); },
  });

  return (
    <div className="pilha estreito">
      <div className="cabeca"><div><h1>Aparência</h1><p className="mut">A cor da sua marca no sistema, nas faturas e nos relatórios.</p></div></div>
      <div className="grade g2">
        <div className="cartao pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Selecao rotulo="Aplicar a" value={escopo} onChange={(e) => setEscopo(e.target.value as 'GRUPO' | 'EMPRESA')}
            dica="A loja usa a cor do grupo, a menos que tenha a própria.">
            {eu.rede && <option value="GRUPO">Todo o grupo</option>}
            <option value="EMPRESA">Só {ativa?.nomeFantasia ?? 'a empresa ativa'}</option>
          </Selecao>
          <div className="linha">
            <div className="fld"><label htmlFor="cor-sel">Cor principal</label><input id="cor-sel" type="color" value={valida ? cor : '#104B3A'} onChange={(e) => { setCor(e.target.value.toUpperCase()); setErroCor(null); }} /></div>
            <Campo rotulo="Código da cor" value={cor} maxLength={7} onChange={(e) => { setCor(e.target.value.toUpperCase()); setErroCor(null); }} erro={!valida ? 'Use o formato #RRGGBB.' : erroCor ?? undefined} style={{ maxWidth: 140 }} />
          </div>
          {d && (
            <Aviso tipo={d.contrasteComMarfim >= 4.5 ? 'ok' : d.contrasteComMarfim >= 3 ? 'aviso' : 'erro'}>
              Contraste de <b>{d.contrasteComMarfim.toFixed(2).replace('.', ',')}:1</b> com o fundo do sistema.{' '}
              {d.contrasteComMarfim >= 4.5 ? 'Boa leitura em botões e textos.' : d.contrasteComMarfim >= 3 ? 'Serve para botões grandes, mas texto pequeno na cor fica difícil de ler.' : 'Clara demais. Escolha uma cor mais escura.'}
              {' '}O texto sobre a cor fica {d.textoSobreMarca === '#FFFFFF' ? 'branco' : 'escuro'}.
            </Aviso>
          )}
          <Botao carregando={salvar.isPending} disabled={!valida || (d?.contrasteComMarfim ?? 0) < 3} onClick={() => { setErro(null); setErroCor(null); salvar.mutate(); }}>Salvar cor</Botao>
          <Aviso>O envio do logotipo chega no próximo módulo. Por enquanto você já escolhe a cor. As cores de erro, aviso, sucesso e dos gráficos não mudam, para “vencido” nunca se confundir com “pago”.</Aviso>
        </div>
        <div className="cartao pilha" style={d ? ({ '--brand': d.marca, '--brand-hover': d.marcaHover, '--brand-ink': d.textoSobreMarca } as React.CSSProperties) : undefined}>
          <h2>Prévia</h2>
          <div className="linha" style={{ alignItems: 'center' }}>
            <div className="cor-amostra" style={{ background: d?.marca ?? '#fff' }} aria-hidden="true" />
            <div><b>{ativa?.nomeFantasia ?? 'Sua empresa'}</b><div className="peq mut">Menu, botões e destaques usam esta cor.</div></div>
          </div>
          <div className="linha"><button type="button" className="btn">Lançar laudo</button><button type="button" className="btn sec">Cancelar</button><Pilula tipo="ok">✓ Quitado</Pilula><Pilula tipo="erro">! Vencido</Pilula></div>
          <div className="nav"><a href="#previa" aria-current="page" onClick={(e) => e.preventDefault()}>Item de menu ativo</a></div>
        </div>
      </div>
    </div>
  );
}
