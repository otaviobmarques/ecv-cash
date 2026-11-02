import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FORMAS_PAGAMENTO_SAAS, ROTULO_FORMA_SAAS, formatarBRL } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, formatarData, useToast } from '@ecv/ui';
import { api } from '../api';
import { useInterno } from '../sessao';
import type { CobrancaGlobal } from '../tipos';

export const PILULA_COBRANCA = {
  ABERTA: <Pilula tipo="aviso">◔ Aberta</Pilula>, PAGA: <Pilula tipo="ok">✓ Paga</Pilula>, CANCELADA: <Pilula>Dispensada</Pilula>,
} as const;
export const PILULA_ASSINATURA = {
  ATIVA: <Pilula tipo="ok">✓ Em dia</Pilula>, INADIMPLENTE: <Pilula tipo="erro">! Inadimplente</Pilula>, CANCELADA: <Pilula>Cancelada</Pilula>,
} as const;
export const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const competenciaBr = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Baixa e cancelamento de uma mensalidade. Usado aqui e dentro do grupo. */
export function AcoesMensalidade({ grupoId, cobrancaId, alvo, onFechar }: { grupoId: string; cobrancaId: string; alvo: 'baixar' | 'cancelar' | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const { avisar } = useToast();
  const [pagoEm, setPagoEm] = useState(hoje());
  const [forma, setForma] = useState<string>('PIX');
  const [ref, setRef] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const executar = useMutation({
    mutationFn: () => alvo === 'baixar'
      ? api.post(`/backoffice/grupos/${grupoId}/cobrancas/${cobrancaId}/baixar`, { pagoEm, forma, referencia: ref || undefined })
      : api.post(`/backoffice/grupos/${grupoId}/cobrancas/${cobrancaId}/cancelar`, { motivo }),
    onSuccess: () => {
      for (const k of ['cobrancas', 'assinaturas', 'assinatura-grupo', 'grupo', 'grupos']) qc.invalidateQueries({ queryKey: [k] });
      avisar(alvo === 'baixar' ? 'Pagamento registrado.' : 'Mensalidade dispensada.'); setMotivo(''); setRef(''); setErro(null); onFechar();
    },
    onError: (e: Error) => setErro(e.message),
  });
  return (
    <Dialogo aberto={!!alvo} onFechar={onFechar} titulo={alvo === 'baixar' ? 'Registrar pagamento' : 'Dispensar mensalidade'}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {alvo === 'baixar' ? (<>
        <Aviso tipo="info">A baixa é manual: confira o recebimento na conta da ECV Cash antes de registrar. Depois de registrada, não se altera.</Aviso>
        <Campo rotulo="Data do pagamento" type="date" max={hoje()} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
        <Selecao rotulo="Forma" value={forma} onChange={(e) => setForma(e.target.value)}>{FORMAS_PAGAMENTO_SAAS.map((f) => <option key={f} value={f}>{ROTULO_FORMA_SAAS[f]}</option>)}</Selecao>
        <Campo rotulo="Referência" dica="Código do PIX, número do comprovante ou do boleto (opcional)." value={ref} onChange={(e) => setRef(e.target.value)} />
      </>) : (<>
        <Aviso tipo="aviso">A competência fica dispensada e não é gerada de novo. Fica registrado no log do cliente.</Aviso>
        <AreaTexto rotulo="Motivo" obrigatorio dica="Mínimo de 10 caracteres." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </>)}
      <Botao carregando={executar.isPending} disabled={alvo === 'cancelar' && motivo.trim().length < 10} onClick={() => { setErro(null); executar.mutate(); }}>Confirmar</Botao>
    </Dialogo>
  );
}

export function Mensalidades() {
  const { data: eu } = useInterno();
  const [status, setStatus] = useState('');
  const [vencidas, setVencidas] = useState(false);
  const [acao, setAcao] = useState<{ c: CobrancaGlobal; tipo: 'baixar' | 'cancelar' } | null>(null);
  const q = useQuery({ queryKey: ['cobrancas', status, vencidas], queryFn: () => api.get<CobrancaGlobal[]>(`/backoffice/cobrancas?status=${status}&vencidas=${vencidas}`) });
  const resumo = useQuery({ queryKey: ['assinaturas'], queryFn: () => api.get<{ grupoId: string; status: string; valorBaseCentavos: number }[]>('/backoffice/assinaturas') });
  const pode = !!eu?.permissoes.includes('assinatura.baixar');
  const itens = q.data ?? [];
  const abertas = itens.filter((c) => c.status === 'ABERTA');
  const emAtraso = abertas.filter((c) => c.vencimento < hoje());
  const soma = (l: CobrancaGlobal[]) => l.reduce((s, c) => s + c.valorCentavos, 0);
  const ativas = (resumo.data ?? []).filter((a) => a.status !== 'CANCELADA');

  return (
    <div className="pilha">
      <div className="cabeca"><div><h1>Mensalidades</h1><p className="mut">O que a ECV Cash tem a receber dos clientes. A baixa é manual.</p></div></div>
      <div className="grade g4">
        <div className="cartao"><span className="mut peq">Assinantes</span><h2>{ativas.length}</h2><span className="peq mut">{ativas.filter((a) => a.status === 'INADIMPLENTE').length} inadimplentes</span></div>
        <div className="cartao"><span className="mut peq">Receita mensal contratada</span><h2>{formatarBRL(ativas.reduce((s, a) => s + a.valorBaseCentavos, 0))}</h2><span className="peq mut">preço-base, sem empresas adicionais</span></div>
        <div className="cartao"><span className="mut peq">A receber (filtro atual)</span><h2>{formatarBRL(soma(abertas))}</h2><span className="peq mut">{abertas.length} mensalidades abertas</span></div>
        <div className="cartao"><span className="mut peq">Em atraso</span><h2>{formatarBRL(soma(emAtraso))}</h2><span className="peq mut">{emAtraso.length} vencidas</span></div>
      </div>
      <div className="cartao pilha">
        <div className="linha">
          <div style={{ minWidth: 180 }}><Selecao rotulo="Situação" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option><option value="ABERTA">Abertas</option><option value="PAGA">Pagas</option><option value="CANCELADA">Dispensadas</option></Selecao></div>
          <label className="linha" style={{ alignItems: 'center', gap: 8 }}><input type="checkbox" checked={vencidas} onChange={(e) => setVencidas(e.target.checked)} /> Só vencidas</label>
        </div>
        {q.isLoading ? <Carregando /> : (
          <div className="tw"><table>
            <thead><tr><th>Cliente</th><th>Competência</th><th>Vencimento</th><th className="num">Valor</th><th>Situação</th><th>Pagamento</th><th /></tr></thead>
            <tbody>
              {itens.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/grupos/${c.grupoId}`}><b>{c.grupoNome}</b></Link></td><td>{competenciaBr(c.competencia)}</td>
                  <td>{formatarData(c.vencimento)} {c.status === 'ABERTA' && c.vencimento < hoje() && <Pilula tipo="erro">! Vencida</Pilula>}</td>
                  <td className="num">{formatarBRL(c.valorCentavos)}</td><td>{PILULA_COBRANCA[c.status]}</td>
                  <td>{c.pagoEm ? <>{formatarData(c.pagoEm)} · {ROTULO_FORMA_SAAS[c.formaPagamento as keyof typeof ROTULO_FORMA_SAAS] ?? c.formaPagamento}</> : '—'}</td>
                  <td>{pode && c.status === 'ABERTA' && <div className="linha"><Botao pequeno onClick={() => setAcao({ c, tipo: 'baixar' })}>Registrar pagamento</Botao><Botao variante="sec" pequeno onClick={() => setAcao({ c, tipo: 'cancelar' })}>Dispensar</Botao></div>}</td>
                </tr>))}
              {itens.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma mensalidade encontrada.</td></tr>}
            </tbody>
          </table></div>)}
      </div>
      <AcoesMensalidade grupoId={acao?.c.grupoId ?? ''} cobrancaId={acao?.c.id ?? ''} alvo={acao?.tipo ?? null} onFechar={() => setAcao(null)} />
    </div>
  );
}
