import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Aviso, Campo, Carregando, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { mensagemDoErro } from '../../formulario';

interface Dados { empresas: { id: string; nome: string }[]; clientes: { id: string; nome: string; tipoPessoa: string; empresaVinculadaId: string | null }[]; fornecedores: { id: string; nome: string; tipo: string; empresaVinculadaId: string | null }[] }

/** Cliente ou fornecedor que é outra empresa do grupo: sai do resultado consolidado da rede (eliminação de intercompany). */
export function Vinculos() {
  const qc = useQueryClient(); const { avisar } = useToast();
  const d = useQuery({ queryKey: ['grupo', 'vinculos'], queryFn: () => api.get<Dados>('/grupo/vinculos') });
  const [busca, setBusca] = useState('');
  const m = useMutation({
    mutationFn: (v: { tipo: 'cliente' | 'fornecedor'; id: string; empresaVinculadaId: string | null }) => api.put('/grupo/vinculos', v),
    onSuccess: () => { avisar('Vínculo salvo. O consolidado já considera.'); qc.invalidateQueries({ queryKey: ['grupo'] }); qc.invalidateQueries({ queryKey: ['relatorios'] }); }, onError: (e) => avisar(mensagemDoErro(e), 'erro'),
  });
  if (d.isLoading) return <Carregando />;
  if (d.isError || !d.data) return <Aviso tipo="erro">{mensagemDoErro(d.error)}</Aviso>;
  const f = (n: string) => n.toLowerCase().includes(busca.toLowerCase());
  const bloco = (titulo: string, tipo: 'cliente' | 'fornecedor', itens: { id: string; nome: string; empresaVinculadaId: string | null }[]) => (
    <div className="pilha" style={{ gap: 8 }}>
      <h3>{titulo}</h3>
      {itens.filter((i) => f(i.nome) || i.empresaVinculadaId).slice(0, 80).map((i) => (
        <div key={i.id} className="linha entre" style={{ alignItems: 'center', borderBottom: '1px solid var(--borda)', paddingBottom: 8 }}>
          <span>{i.nome}</span>
          <Selecao rotulo="" aria-label={`Empresa do grupo para ${i.nome}`} value={i.empresaVinculadaId ?? ''} onChange={(e) => m.mutate({ tipo, id: i.id, empresaVinculadaId: e.target.value || null })}>
            <option value="">Não é do grupo</option>{d.data!.empresas.map((e) => <option key={e.id} value={e.id}>É a empresa {e.nome}</option>)}
          </Selecao>
        </div>
      ))}
    </div>
  );
  return (
    <div className="cartao pilha">
      <p className="mut">Se uma loja do grupo atende outra loja (cliente) ou cobra outra loja (fornecedor), marque aqui. Cada loja continua vendo o resultado completo, mas o consolidado da rede (Relatórios) tira esse movimento, para não contar duas vezes.</p>
      <Campo rotulo="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do cliente ou fornecedor" />
      {bloco('Clientes', 'cliente', d.data.clientes)}
      {bloco('Fornecedores', 'fornecedor', d.data.fornecedores)}
    </div>
  );
}
