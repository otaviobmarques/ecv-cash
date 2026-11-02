import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Aviso, Botao, Carregando, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { dataBr, mensagemDoErro } from '../../formulario';

interface Item { id: string; nome: string; documento: string | null; ultimoMovimento: string; nuncaTeveLaudo: boolean }

/** Prazo de retenção (LGPD): pessoas físicas sem movimento há anos e sem nada em aberto, para anonimizar em lote. */
export function Retencao() {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [anos, setAnos] = useState('5'); const [sel, setSel] = useState<Set<string>>(new Set()); const [erro, setErro] = useState<string | null>(null);
  const lista = useQuery({ queryKey: ['lgpd', 'retencao', anos], queryFn: () => api.get<{ itens: Item[] }>(`/lgpd/retencao?anos=${anos}`) });
  const m = useMutation({
    mutationFn: () => api.post<{ anonimizados: number; erros: number }>('/lgpd/retencao/anonimizar', { ids: [...sel], anos: Number(anos) }),
    onSuccess: (r) => { avisar(`${r.anonimizados} ${r.anonimizados === 1 ? 'pessoa anonimizada' : 'pessoas anonimizadas'}${r.erros ? `, ${r.erros} com problema` : ''}.`); setSel(new Set()); setErro(null); qc.invalidateQueries({ queryKey: ['lgpd'] }); qc.invalidateQueries({ queryKey: ['clientes'] }); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  const itens = lista.data?.itens ?? [];
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="cartao pilha">
      <p className="mut">A lei manda guardar os lançamentos financeiros por 5 anos. Passado o prazo, o nome, o CPF, os e-mails e o telefone de quem não tem mais relação com a loja podem ser apagados. Os valores e as datas dos laudos ficam. Aqui aparecem as pessoas físicas sem laudo há pelo menos o prazo escolhido e sem nada em aberto. A anonimização não tem volta e fica na auditoria.</p>
      <Selecao rotulo="Parado há pelo menos" value={anos} onChange={(e) => { setAnos(e.target.value); setSel(new Set()); }}>{['5', '6', '7', '10'].map((a) => <option key={a} value={a}>{a} anos</option>)}</Selecao>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.isLoading ? <Carregando /> : lista.isError ? <Aviso tipo="erro">{mensagemDoErro(lista.error)}</Aviso> : (
        <div className="tw"><table>
          <thead><tr><th><input type="checkbox" aria-label="Selecionar todos" checked={itens.length > 0 && sel.size === itens.length} onChange={(e) => setSel(e.target.checked ? new Set(itens.map((i) => i.id)) : new Set())} /></th><th>Pessoa</th><th>CPF</th><th>Último movimento</th></tr></thead>
          <tbody>
            {itens.map((i) => <tr key={i.id}><td><input type="checkbox" aria-label={`Selecionar ${i.nome}`} checked={sel.has(i.id)} onChange={() => alternar(i.id)} /></td><td>{i.nome}</td><td>{i.documento ?? '—'}</td><td>{dataBr(i.ultimoMovimento)}{i.nuncaTeveLaudo && <> <Pilula>Sem laudos</Pilula></>}</td></tr>)}
            {itens.length === 0 && <tr><td colSpan={4} className="vazio">Ninguém passou do prazo de {anos} anos.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Botao variante="perigo" disabled={sel.size === 0} carregando={m.isPending} onClick={() => m.mutate()}>Anonimizar {sel.size || ''} {sel.size === 1 ? 'selecionada' : 'selecionadas'}</Botao>
    </div>
  );
}
