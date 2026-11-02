import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarBRL, assinaturaSaasSchema, ROTULO_FORMA_SAAS } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, CampoDinheiro, CampoPercentual, Carregando, Dialogo, Selecao, formatarData, useToast } from '@ecv/ui';
import { api } from '../api';
import { useInterno } from '../sessao';
import type { AssinaturaDoGrupo, PlanoSaas } from '../tipos';
import { AcoesMensalidade, PILULA_ASSINATURA, PILULA_COBRANCA, competenciaBr, hoje } from './Mensalidades';

type Form = { planoId: string; base: number | null; incluidas: string; adicional: number | null; descontoBp: number | null; dia: string; inicio: string; testeAte: string; carencia: string; suspende: boolean; motivo: string };
const novo = (): Form => ({ planoId: '', base: null, incluidas: '1', adicional: 0, descontoBp: 0, dia: '10', inicio: hoje(), testeAte: '', carencia: '15', suspende: false, motivo: '' });

export function AssinaturaGrupo({ grupoId }: { grupoId: string }) {
  const { data: eu } = useInterno();
  const qc = useQueryClient();
  const { avisar } = useToast();
  const d = useQuery({ queryKey: ['assinatura-grupo', grupoId], queryFn: () => api.get<AssinaturaDoGrupo>(`/backoffice/grupos/${grupoId}/assinatura`) });
  const planos = useQuery({ queryKey: ['planos'], queryFn: () => api.get<PlanoSaas[]>('/backoffice/planos') });
  const [form, setForm] = useState<'contratar' | 'editar' | null>(null);
  const [f, setF] = useState<Form>(novo());
  const [cancelar, setCancelar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [mensal, setMensal] = useState<{ id: string; tipo: 'baixar' | 'cancelar' } | null>(null);
  const gerir = !!eu?.permissoes.includes('assinatura.gerir');
  const baixar = !!eu?.permissoes.includes('assinatura.baixar');
  const a = d.data?.assinatura;
  const refrescar = () => { for (const k of ['assinatura-grupo', 'assinaturas', 'cobrancas', 'grupo', 'grupo-log', 'grupos']) qc.invalidateQueries({ queryKey: [k] }); };

  const escolherPlano = (id: string) => {
    const p = planos.data?.find((x) => x.id === id);
    setF((v) => ({ ...v, planoId: id, ...(p ? { base: p.valorBaseCentavos, incluidas: String(p.empresasIncluidas), adicional: p.valorEmpresaAdicionalCentavos } : {}) }));
  };
  const abrirContratar = () => { setF(novo()); setErro(null); setForm('contratar'); };
  const abrirEditar = () => {
    if (!a) return;
    setF({ planoId: a.planoId, base: a.valorBaseCentavos, incluidas: String(a.empresasIncluidas), adicional: a.valorEmpresaAdicionalCentavos, descontoBp: a.descontoBp, dia: String(a.diaVencimento), inicio: a.inicio.slice(0, 10), testeAte: a.testeAte?.slice(0, 10) ?? '', carencia: String(a.carenciaDias), suspende: a.suspendeEmAtraso, motivo: '' });
    setErro(null); setForm('editar');
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const dto = {
        planoId: f.planoId, valorBaseCentavos: f.base ?? undefined, empresasIncluidas: Number(f.incluidas), valorEmpresaAdicionalCentavos: f.adicional ?? 0, descontoBp: f.descontoBp ?? 0,
        diaVencimento: Number(f.dia), inicio: f.inicio, testeAte: f.testeAte || undefined, carenciaDias: Number(f.carencia), suspendeEmAtraso: f.suspende,
      };
      if (form === 'contratar') {
        const v = assinaturaSaasSchema.safeParse(dto);
        if (!v.success) throw new Error(v.error.issues[0]!.message);
        return api.post(`/backoffice/grupos/${grupoId}/assinatura`, v.data);
      }
      return api.patch(`/backoffice/grupos/${grupoId}/assinatura`, { ...dto, motivo: f.motivo });
    },
    onSuccess: () => { refrescar(); setForm(null); avisar(form === 'contratar' ? 'Assinatura criada.' : 'Contrato atualizado. Vale para as próximas mensalidades.'); },
    onError: (e: Error) => setErro(e.message),
  });
  const cancelarAss = useMutation({
    mutationFn: () => api.post(`/backoffice/grupos/${grupoId}/assinatura/cancelar`, { motivo }),
    onSuccess: () => { refrescar(); setCancelar(false); setMotivo(''); avisar('Assinatura cancelada.'); },
    onError: (e: Error) => setErro(e.message),
  });
  const gerar = useMutation({
    mutationFn: () => api.post<{ geradas: number }>(`/backoffice/grupos/${grupoId}/assinatura/gerar`),
    onSuccess: (r) => { refrescar(); avisar(r.geradas ? `${r.geradas} mensalidade(s) gerada(s).` : 'Nada novo para gerar.'); },
    onError: (e: Error) => avisar(e.message, 'erro'),
  });

  if (d.isLoading) return <div className="cartao"><Carregando /></div>;
  return (
    <div className="cartao pilha">
      <div className="cabeca">
        <h2>Assinatura</h2>
        <div className="linha" style={{ alignItems: 'center' }}>
          {a && PILULA_ASSINATURA[a.status]}
          {gerir && !a && <Botao onClick={abrirContratar}>Contratar plano</Botao>}
          {gerir && a && a.status !== 'CANCELADA' && <>
            <Botao variante="sec" onClick={() => gerar.mutate()} carregando={gerar.isPending}>Gerar mensalidades</Botao>
            <Botao variante="sec" onClick={abrirEditar}>Editar contrato</Botao>
            <Botao variante="perigo" onClick={() => { setErro(null); setCancelar(true); }}>Cancelar assinatura</Botao>
          </>}
        </div>
      </div>
      {!a && <p className="mut">Este grupo ainda não tem assinatura. Contrate um plano para a mensalidade passar a ser gerada.</p>}
      {a && (<>
        {a.suspensoPorAtraso && <Aviso tipo="erro">O grupo está suspenso por inadimplência. Ele volta sozinho quando as mensalidades vencidas forem pagas.</Aviso>}
        {a.status === 'CANCELADA' && <Aviso tipo="aviso">Cancelada: {a.motivoCancelamento}</Aviso>}
        <div className="grade g4">
          <div><span className="mut peq">Plano</span><div><b>{a.planoNome}</b></div></div>
          <div><span className="mut peq">Mensalidade</span><div><b>{formatarBRL(a.valorBaseCentavos)}</b>{a.descontoBp > 0 && <span className="peq mut"> com {(a.descontoBp / 100).toFixed(2).replace('.', ',')}% de desconto</span>}</div></div>
          <div><span className="mut peq">Empresas</span><div>{d.data!.empresasAtivas} ativa(s), {a.empresasIncluidas} incluída(s); adicional {formatarBRL(a.valorEmpresaAdicionalCentavos)}</div></div>
          <div><span className="mut peq">Vencimento</span><div>Dia {a.diaVencimento}{a.testeAte && <span className="peq mut"> · teste até {formatarData(a.testeAte)}</span>}</div></div>
        </div>
        <p className="peq mut">Carência de {a.carenciaDias} dias após o vencimento{a.suspendeEmAtraso ? '; depois disso o grupo é suspenso automaticamente' : '; depois disso só é marcado como inadimplente'}.</p>
        <div className="tw"><table>
          <thead><tr><th>Competência</th><th>Vencimento</th><th className="num">Empresas</th><th className="num">Valor</th><th>Situação</th><th>Pagamento</th><th /></tr></thead>
          <tbody>
            {d.data!.cobrancas.map((c) => (
              <tr key={c.id}>
                <td>{competenciaBr(c.competencia)}</td><td>{formatarData(c.vencimento)}</td><td className="num">{c.empresasCobradas}</td>
                <td className="num">{formatarBRL(c.valorCentavos)}{c.descontoCentavos > 0 && <div className="peq mut">desconto {formatarBRL(c.descontoCentavos)}</div>}</td>
                <td>{PILULA_COBRANCA[c.status]}{c.motivoCancelamento && <div className="peq mut">{c.motivoCancelamento}</div>}</td>
                <td>{c.pagoEm ? <>{formatarData(c.pagoEm)} · {ROTULO_FORMA_SAAS[c.formaPagamento as keyof typeof ROTULO_FORMA_SAAS] ?? c.formaPagamento}{c.referencia && <div className="peq mut">{c.referencia}</div>}</> : '—'}</td>
                <td>{baixar && c.status === 'ABERTA' && <div className="linha"><Botao pequeno onClick={() => setMensal({ id: c.id, tipo: 'baixar' })}>Registrar pagamento</Botao><Botao variante="sec" pequeno onClick={() => setMensal({ id: c.id, tipo: 'cancelar' })}>Dispensar</Botao></div>}</td>
              </tr>))}
            {d.data!.cobrancas.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma mensalidade gerada ainda{a.testeAte && a.testeAte >= hoje() ? ' (em período de teste)' : ''}.</td></tr>}
          </tbody>
        </table></div>
      </>)}

      <Dialogo aberto={!!form} onFechar={() => setForm(null)} titulo={form === 'contratar' ? 'Contratar plano' : 'Editar contrato'} lateral>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao rotulo="Plano" obrigatorio value={f.planoId} onChange={(e) => escolherPlano(e.target.value)}>
          <option value="">Escolha…</option>
          {planos.data?.filter((p) => p.ativo || p.id === f.planoId).map((p) => <option key={p.id} value={p.id}>{p.nome} · {formatarBRL(p.valorBaseCentavos)}</option>)}
        </Selecao>
        <CampoDinheiro key={`b${f.planoId}`} rotulo="Mensalidade combinada (R$)" centavos={f.base} onChange={(v) => setF({ ...f, base: v })} dica="Vem do plano; altere para um preço negociado." />
        <div className="grade g2">
          <Campo key={`i${f.planoId}`} rotulo="Empresas incluídas" type="number" min={1} value={f.incluidas} onChange={(e) => setF({ ...f, incluidas: e.target.value })} />
          <CampoDinheiro key={`a${f.planoId}`} rotulo="Por empresa adicional (R$)" centavos={f.adicional} onChange={(v) => setF({ ...f, adicional: v })} />
        </div>
        <CampoPercentual rotulo="Desconto (%)" bp={f.descontoBp} onChange={(v) => setF({ ...f, descontoBp: v })} />
        <div className="grade g2">
          <Campo rotulo="Dia do vencimento (1 a 28)" type="number" min={1} max={28} value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} />
          <Campo rotulo="Carência (dias)" type="number" min={0} max={90} value={f.carencia} onChange={(e) => setF({ ...f, carencia: e.target.value })} />
        </div>
        <div className="grade g2">
          <Campo rotulo="Início do contrato" type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
          <Campo rotulo="Teste grátis até" type="date" value={f.testeAte} onChange={(e) => setF({ ...f, testeAte: e.target.value })} dica="Opcional. Não cobra vencimentos até esta data." />
        </div>
        <label className="linha" style={{ alignItems: 'center', gap: 8 }}><input type="checkbox" checked={f.suspende} onChange={(e) => setF({ ...f, suspende: e.target.checked })} /> Suspender o grupo automaticamente ao passar da carência</label>
        {form === 'editar' && <AreaTexto rotulo="Motivo da alteração" obrigatorio dica="Mínimo de 10 caracteres. Vale só para as próximas mensalidades." value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />}
        <Botao carregando={salvar.isPending} disabled={!f.planoId || (form === 'editar' && f.motivo.trim().length < 10)} onClick={() => { setErro(null); salvar.mutate(); }}>Salvar</Botao>
      </Dialogo>

      <Dialogo aberto={cancelar} onFechar={() => setCancelar(false)} titulo="Cancelar assinatura">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Aviso tipo="aviso">As mensalidades abertas são dispensadas e nada mais é cobrado. Se o grupo estava suspenso por inadimplência, ele é reativado.</Aviso>
        <AreaTexto rotulo="Motivo" obrigatorio dica="Mínimo de 10 caracteres." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <Botao variante="perigo" carregando={cancelarAss.isPending} disabled={motivo.trim().length < 10} onClick={() => { setErro(null); cancelarAss.mutate(); }}>Cancelar assinatura</Botao>
      </Dialogo>
      <AcoesMensalidade grupoId={grupoId} cobrancaId={mensal?.id ?? ''} alvo={mensal?.tipo ?? null} onFechar={() => setMensal(null)} />
    </div>
  );
}
