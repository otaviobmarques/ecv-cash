import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarBRL, planoSaasSchema } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, CampoDinheiro, Carregando, Dialogo, Pilula, useToast } from '@ecv/ui';
import { api } from '../api';
import { useInterno } from '../sessao';
import type { PlanoSaas } from '../tipos';

const vazio = { nome: '', descricao: '', base: null as number | null, incluidas: '1', adicional: 0 as number | null };

export function Planos() {
  const { data: eu } = useInterno();
  const qc = useQueryClient();
  const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['planos'], queryFn: () => api.get<PlanoSaas[]>('/backoffice/planos') });
  const [editando, setEditando] = useState<PlanoSaas | 'novo' | null>(null);
  const [f, setF] = useState(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const pode = !!eu?.permissoes.includes('plano.gerir');

  const abrir = (p: PlanoSaas | 'novo') => {
    setEditando(p); setErro(null);
    setF(p === 'novo' ? vazio : { nome: p.nome, descricao: p.descricao ?? '', base: p.valorBaseCentavos, incluidas: String(p.empresasIncluidas), adicional: p.valorEmpresaAdicionalCentavos });
  };
  const salvar = useMutation({
    mutationFn: async () => {
      const dto = { nome: f.nome, descricao: f.descricao || undefined, valorBaseCentavos: f.base ?? 0, empresasIncluidas: Number(f.incluidas), valorEmpresaAdicionalCentavos: f.adicional ?? 0 };
      const v = planoSaasSchema.safeParse(dto);
      if (!v.success) throw new Error(v.error.issues[0]!.message);
      return editando === 'novo' ? api.post('/backoffice/planos', v.data) : api.patch(`/backoffice/planos/${(editando as PlanoSaas).id}`, v.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['planos'] }); setEditando(null); avisar('Plano salvo.'); },
    onError: (e: Error) => setErro(e.message),
  });
  const alternar = useMutation({
    mutationFn: (p: PlanoSaas) => api.patch(`/backoffice/planos/${p.id}`, { ativo: !p.ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planos'] }),
    onError: (e: Error) => avisar(e.message, 'erro'),
  });

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Planos</h1><p className="mut">Preço de tabela da assinatura. Mudar um plano não mexe nos contratos já feitos: cada cliente guarda o preço combinado.</p></div>
        {pode && <Botao onClick={() => abrir('novo')}>Novo plano</Botao>}
      </div>
      <div className="cartao">
        {lista.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Plano</th><th className="num">Mensalidade</th><th className="num">Empresas incluídas</th><th className="num">Empresa adicional</th><th className="num">Assinantes</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.data?.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.nome}</b>{p.descricao && <div className="peq mut">{p.descricao}</div>}</td>
                  <td className="num">{formatarBRL(p.valorBaseCentavos)}</td><td className="num">{p.empresasIncluidas}</td>
                  <td className="num">{formatarBRL(p.valorEmpresaAdicionalCentavos)}</td><td className="num">{p.assinaturas}</td>
                  <td>{p.ativo ? <Pilula tipo="ok">✓ Ativo</Pilula> : <Pilula>Desativado</Pilula>}</td>
                  <td>{pode && <div className="linha"><Botao variante="sec" pequeno onClick={() => abrir(p)}>Editar</Botao><Botao variante="sec" pequeno onClick={() => alternar.mutate(p)}>{p.ativo ? 'Desativar' : 'Reativar'}</Botao></div>}</td>
                </tr>))}
              {lista.data?.length === 0 && <tr><td colSpan={7} className="vazio">Nenhum plano ainda. Crie o primeiro para poder contratar clientes.</td></tr>}
            </tbody>
          </table></div>)}
      </div>
      <Dialogo aberto={!!editando} onFechar={() => setEditando(null)} titulo={editando === 'novo' ? 'Novo plano' : 'Editar plano'}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        <AreaTexto rotulo="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        <CampoDinheiro rotulo="Mensalidade base (R$)" obrigatorio centavos={f.base} onChange={(v) => setF({ ...f, base: v })} />
        <Campo rotulo="Empresas incluídas na mensalidade" type="number" min={1} value={f.incluidas} onChange={(e) => setF({ ...f, incluidas: e.target.value })} />
        <CampoDinheiro rotulo="Por empresa adicional (R$)" centavos={f.adicional} onChange={(v) => setF({ ...f, adicional: v })} dica="Cobrado por mês, por empresa ativa além das incluídas." />
        <Botao carregando={salvar.isPending} onClick={() => { setErro(null); salvar.mutate(); }}>Salvar</Botao>
      </Dialogo>
    </div>
  );
}
