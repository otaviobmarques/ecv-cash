import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { ROTULO_IMPOSTO } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Dialogo, ErroApi, Pilula, Selecao, useToast } from '@ecv/ui';
import { api } from '../../api';
import { CampoPercentual, dataBr, hojeIso, mensagemDoErro, pct } from '../../formulario';
import type { Aliquota, Eu } from '../../tipos';

export function Aliquotas() {
  const { eu } = useOutletContext<{ eu: Eu }>();
  const qc = useQueryClient(); const { avisar } = useToast();
  const lista = useQuery({ queryKey: ['aliquotas', eu.empresaAtivaId], enabled: !!eu.empresaAtivaId, queryFn: () => api.get<Aliquota[]>('/aliquotas') });
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ nome: 'ISS', descricao: '', bp: null as number | null, ini: hojeIso(), fim: '' });
  const [erro, setErro] = useState<string | null>(null); const [campos, setCampos] = useState<Record<string, string>>({});
  const podeEditar = eu.permissoes.includes('aliquota.editar');
  const criar = useMutation({
    mutationFn: () => api.post('/aliquotas', { nome: f.nome, descricao: f.descricao || undefined, percentualBp: f.bp ?? undefined, vigenciaIni: f.ini, vigenciaFim: f.fim || undefined }),
    onSuccess: () => { avisar('Alíquota cadastrada.'); setAberto(false); qc.invalidateQueries({ queryKey: ['aliquotas'] }); }, onError: (e) => { setErro(mensagemDoErro(e)); setCampos((e as ErroApi).campos ?? {}); },
  });
  const encerrar = useMutation({
    mutationFn: (v: { id: string; fim?: string | null; ativa?: boolean }) => api.patch(`/aliquotas/${v.id}`, { vigenciaFim: v.fim, ativa: v.ativa }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['aliquotas'] }); }, onError: (e) => avisar(mensagemDoErro(e), 'erro'),
  });
  return (
    <div className="cartao pilha">
      <div className="linha entre"><p className="mut">Alíquotas da loja ativa, com vigência. Entram como dedução no DRE; o sistema não apura nem emite imposto. Para reajustar, encerre a vigência e cadastre a nova.</p>{podeEditar && <Botao onClick={() => { setAberto(true); setErro(null); setCampos({}); }}>Nova alíquota</Botao>}</div>
      {lista.isLoading ? <Carregando /> : (
        <div className="tw"><table>
          <thead><tr><th>Imposto</th><th className="num">Alíquota</th><th>Vigência</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.data?.map((a) => <tr key={a.id}><td><b>{a.nome === 'OUTRO' ? a.descricao : ROTULO_IMPOSTO[a.nome]}</b></td><td className="num">{pct(a.percentualBp)}</td><td>{dataBr(a.vigenciaIni)}{a.vigenciaFim ? ` a ${dataBr(a.vigenciaFim)}` : ' em diante'}</td><td>{a.ativa ? <Pilula tipo="ok">✓ Ativa</Pilula> : <Pilula>Inativa</Pilula>}</td>
              <td>{podeEditar && a.ativa && !a.vigenciaFim && <Botao variante="sec" pequeno onClick={() => encerrar.mutate({ id: a.id, fim: hojeIso() })}>Encerrar hoje</Botao>}{podeEditar && a.ativa && <> <Botao variante="sec" pequeno onClick={() => encerrar.mutate({ id: a.id, ativa: false })}>Desativar</Botao></>}</td></tr>)}
            {lista.data?.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma alíquota cadastrada. Sem alíquota, o DRE não mostra dedução de impostos.</td></tr>}
          </tbody>
        </table></div>
      )}
      <Dialogo aberto={aberto} onFechar={() => setAberto(false)} titulo="Nova alíquota">
        <div className="pilha">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Selecao rotulo="Imposto" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })}>{Object.entries(ROTULO_IMPOSTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selecao>
          {f.nome === 'OUTRO' && <Campo rotulo="Qual imposto" obrigatorio value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} erro={campos.descricao} />}
          <CampoPercentual rotulo="Alíquota sobre o faturamento (%)" obrigatorio bp={f.bp} onChange={(b) => setF({ ...f, bp: b })} erro={campos.percentualBp} />
          <div className="linha"><Campo rotulo="Vale desde" type="date" value={f.ini} onChange={(e) => setF({ ...f, ini: e.target.value })} erro={campos.vigenciaIni} /><Campo rotulo="Até (opcional)" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} erro={campos.vigenciaFim} /></div>
          <Botao carregando={criar.isPending} onClick={() => criar.mutate()}>Cadastrar</Botao>
        </div>
      </Dialogo>
    </div>
  );
}
