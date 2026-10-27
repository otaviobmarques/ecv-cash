import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { ROTULO_TIPO_FORMA, formaPagamentoSchema, type TipoFormaPagamento } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { CampoPercentual, camposDoErro, checar, mensagemDoErro, pct } from '../../formulario';
import type { Empresa, Eu, FormaPagamento } from '../../tipos';

const COM_TAXA = ['CARTAO_DEBITO', 'CARTAO_CREDITO'];

export function Formas() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['formas'], queryFn: () => api.get<FormaPagamento[]>('/formas-pagamento') });
  const [nova, setNova] = useState(false);
  const [taxas, setTaxas] = useState<FormaPagamento | null>(null);
  const edita = eu.permissoes.includes('forma_pagamento.editar');
  const veTaxas = eu.permissoes.includes('forma_pagamento_empresa.editar') || eu.permissoes.includes('forma_pagamento.editar') || eu.perfilAtivo === 'FINANCEIRO';
  const alterna = useMutation({
    mutationFn: (f: FormaPagamento) => api.patch(`/formas-pagamento/${f.id}`, { status: f.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['formas'] }); avisar('Forma de pagamento atualizada.'); },
    onError: (e) => avisar(mensagemDoErro(e), 'erro'),
  });

  return (
    <div className="cartao pilha">
      <div className="cabeca"><p className="mut">As formas de pagamento valem para o grupo. A taxa da operadora, o prazo de recebimento e a antecipação do cartão são de cada loja e entram no fluxo de caixa previsto.</p>
        {edita && <Botao onClick={() => setNova(true)}>Nova forma de pagamento</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Forma</th><th>Tipo</th>{veTaxas && <><th>Gera fatura</th><th>Taxas por loja</th><th>Situação</th></>}<th /></tr></thead>
          <tbody>
            {lista.data?.map((f) => (
              <tr key={f.id}><td><b>{f.nome}</b></td><td>{ROTULO_TIPO_FORMA[f.tipo as TipoFormaPagamento] ?? f.tipo}</td>
                {veTaxas && <><td>{f.geraFatura ? 'Sim' : 'Não'}</td>
                  <td>{COM_TAXA.includes(f.tipo) ? (f.empresas?.length ? f.empresas.map((e) => <div key={e.empresaId} className="peq">{empresas.find((x) => x.id === e.empresaId)?.nomeFantasia ?? 'Loja'}: {pct(e.taxaBp)} · recebe em {e.prazoDias} dia(s){e.antecipacaoBp ? ` · antecipação ${pct(e.antecipacaoBp)}` : ''}</div>) : <span className="mut peq">Não configurada</span>) : <span className="mut">—</span>}</td>
                  <td>{f.status === 'ATIVO' ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td></>}
                <td><div className="linha">{COM_TAXA.includes(f.tipo) && <Botao variante="sec" pequeno onClick={() => setTaxas(f)}>Taxas por loja</Botao>}{edita && <Botao variante="sec" pequeno onClick={() => alterna.mutate(f)}>{f.status === 'ATIVO' ? 'Inativar' : 'Reativar'}</Botao>}</div></td></tr>
            ))}
          </tbody>
        </table></div>
      )}
      <FormNova aberto={nova} onFechar={() => setNova(false)} />
      <FormTaxas forma={taxas} eu={eu} empresas={empresas} onFechar={() => setTaxas(null)} />
    </div>
  );
}

function FormNova({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [f, setF] = useState({ nome: '', tipo: 'OUTRA', geraFatura: false });
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (v: unknown) => api.post('/formas-pagamento', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['formas'] }); avisar('Forma de pagamento cadastrada.'); setF({ nome: '', tipo: 'OUTRA', geraFatura: false }); onFechar(); },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => { setErro(null); const r = checar(formaPagamentoSchema, f); if (r.erros) { setErros(r.erros); return; } setErros({}); salvar.mutate(r.dados); };
  return (
    <Dialogo aberto={aberto} onFechar={onFechar} titulo="Nova forma de pagamento">
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" obrigatorio value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} erro={erros.nome} />
        <Selecao rotulo="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value, geraFatura: e.target.value === 'FATURADO' })}>{Object.entries(ROTULO_TIPO_FORMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selecao>
        <label className="check"><input type="checkbox" checked={f.geraFatura} onChange={(e) => setF({ ...f, geraFatura: e.target.checked })} />Os laudos desta forma ficam em fatura (cobrança agrupada por cliente e período)</label>
        <Botao carregando={salvar.isPending} onClick={enviar}>Cadastrar forma de pagamento</Botao>
      </div>
    </Dialogo>
  );
}

function FormTaxas({ forma, eu, empresas, onFechar }: { forma: FormaPagamento | null; eu: Eu; empresas: Empresa[]; onFechar: () => void }) {
  const editaEm = (id: string) => eu.rede || eu.empresas.find((x) => x.id === id)?.perfil === 'GERENTE';
  return (
    <Dialogo aberto={!!forma} onFechar={onFechar} titulo={`Taxas de ${forma?.nome ?? ''}`} lateral>
      <p className="mut peq">Cada loja tem a sua taxa, o seu prazo de recebimento e, se usar, a taxa de antecipação.</p>
      {empresas.map((e) => <LinhaTaxa key={e.id + (forma?.id ?? '')} forma={forma!} empresa={e} pode={editaEm(e.id)} />)}
    </Dialogo>
  );
}

function LinhaTaxa({ forma, empresa, pode }: { forma: FormaPagamento; empresa: Empresa; pode: boolean }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const atual = forma.empresas?.find((x) => x.empresaId === empresa.id);
  const [v, setV] = useState({ taxaBp: atual?.taxaBp ?? 0, prazoDias: String(atual?.prazoDias ?? 0), antecipacaoBp: atual?.antecipacaoBp ?? 0 });
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () => api.put(`/formas-pagamento/${forma.id}/empresas/${empresa.id}`, { taxaBp: v.taxaBp ?? 0, prazoDias: Number(v.prazoDias) || 0, antecipacaoBp: v.antecipacaoBp ?? 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['formas'] }); avisar(`Taxas de ${empresa.nomeFantasia} salvas.`); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  return (
    <div className="cartao pilha" style={{ border: '1px solid var(--borda)' }}>
      <h3>{empresa.nomeFantasia}</h3>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade g3">
        <CampoPercentual rotulo="Taxa (%)" bp={v.taxaBp} onChange={(b) => setV({ ...v, taxaBp: b ?? 0 })} />
        <Campo rotulo="Recebe em (dias)" inputMode="numeric" value={v.prazoDias} onChange={(e) => setV({ ...v, prazoDias: e.target.value })} />
        <CampoPercentual rotulo="Antecipação (%)" bp={v.antecipacaoBp} onChange={(b) => setV({ ...v, antecipacaoBp: b ?? 0 })} />
      </div>
      {pode ? <Botao carregando={salvar.isPending} onClick={() => { setErro(null); salvar.mutate(); }}>Salvar</Botao> : <span className="peq mut">Só o Gerente desta loja ou o Administrativo altera.</span>}
    </div>
  );
}
