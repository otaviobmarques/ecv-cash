import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { ROTULO_PERFIL, formatarBRL } from '@ecv/shared';
import { Aviso, Carregando, Pilula } from '@ecv/ui';
import { api } from '../api';
import { dataBr } from '../formulario';
import type { Empresa, Eu, Painel } from '../tipos';

function Numero({ rotulo, valor, nota, alerta, para }: { rotulo: string; valor: string; nota?: string; alerta?: boolean; para?: string }) {
  const conteudo = (
    <div className="cartao" style={{ padding: 16, height: '100%' }}>
      <div className="mut peq">{rotulo}</div>
      <div className="num" style={{ fontSize: 26, fontWeight: 700, textAlign: 'left', color: alerta ? 'var(--erro)' : 'var(--verde)' }}>{valor}</div>
      {nota && <div className="mut peq">{nota}</div>}
    </div>
  );
  return para ? <Link to={para} style={{ textDecoration: 'none', color: 'inherit' }}>{conteudo}</Link> : conteudo;
}

/** Barras dos últimos 30 dias de faturamento (valor cobrado nos laudos), com a escala no próprio gráfico. */
function Serie({ serie }: { serie: { dia: string; valor: number; laudos: number }[] }) {
  const max = Math.max(1, ...serie.map((s) => s.valor));
  const W = 720, H = 150, base = 120, bw = W / serie.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Faturamento dos laudos nos últimos 30 dias. Maior dia: ${formatarBRL(max)}.`} style={{ width: '100%', height: 'auto', maxHeight: 190 }}>
      {[0, 0.5, 1].map((f) => <g key={f}><line x1="0" x2={W} y1={base - f * 100} y2={base - f * 100} stroke="var(--borda)" strokeWidth="1" /><text x="2" y={base - f * 100 - 3} fontSize="9" fill="var(--texto-2)">{f === 0 ? 'R$ 0' : formatarBRL(Math.round(max * f))}</text></g>)}
      {serie.map((s, i) => { const h = (s.valor / max) * 100; return <rect key={s.dia} x={i * bw + 2} y={base - h} width={bw - 4} height={Math.max(h, s.valor > 0 ? 1.5 : 0)} rx="2" fill="var(--esmeralda, #008B49)"><title>{`${dataBr(s.dia)}: ${formatarBRL(s.valor)} em ${s.laudos} laudos`}</title></rect>; })}
      <text x="2" y={H - 6} fontSize="10" fill="var(--texto-2)">{dataBr(serie[0]!.dia).slice(0, 5)}</text>
      <text x={W - 2} y={H - 6} fontSize="10" textAnchor="end" fill="var(--texto-2)">{dataBr(serie[serie.length - 1]!.dia).slice(0, 5)}</text>
    </svg>
  );
}

export function Inicio() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const ativa = empresas.find((e) => e.id === eu.empresaAtivaId);
  const p = useQuery({ queryKey: ['painel', eu.empresaAtivaId], enabled: !!eu.empresaAtivaId, queryFn: () => api.get<Painel>('/dashboard') });
  const d = p.data;
  const dinheiro = d && d.perfil && d.perfil !== 'VISTORIADOR';
  return (
    <div className="pilha estreito">
      <div className="cabeca">
        <div><h1>Olá, {eu.nome.split(' ')[0]}</h1><p className="mut">{ativa ? <>Você está em <b>{ativa.nomeFantasia}</b>.</> : 'Você ainda não tem uma loja atribuída.'}</p></div>
        {eu.perfilAtivo && <Pilula tipo="ok">{ROTULO_PERFIL[eu.perfilAtivo]}</Pilula>}
      </div>
      {p.isLoading && ativa && <Carregando />}
      {d?.perfil === 'VISTORIADOR' && (
        <>
          {!d.vinculado && <Aviso tipo="aviso">Seu usuário ainda não está ligado a um cadastro de vistoriador. Peça ao gerente para ligar em Cadastros › Vistoriadores.</Aviso>}
          <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Numero rotulo="Laudos hoje" valor={String(d.laudosHoje ?? 0)} para="/lancar" nota="Lançar mais um" />
            <Numero rotulo="Laudos no mês" valor={String(d.laudosMes ?? 0)} para="/laudos" />
          </div>
          <div className="cartao pilha"><h2>Seus últimos laudos</h2>
            {d.ultimos?.length ? <div className="tw"><table><thead><tr><th>Nº</th><th>Data</th><th>Placa</th><th>Serviço</th></tr></thead><tbody>{d.ultimos.map((u) => <tr key={u.id}><td>{u.numero}</td><td>{dataBr(u.dataLaudo)}</td><td><b>{u.placa}</b></td><td>{u.servico}</td></tr>)}</tbody></table></div> : <span className="mut">Nenhum laudo lançado ainda.</span>}
          </div>
        </>
      )}
      {dinheiro && d && (
        <>
          <div className="grade" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Numero rotulo="Laudos hoje" valor={String(d.laudosHoje ?? 0)} nota={formatarBRL(d.valorHoje ?? 0)} para="/laudos" />
            <Numero rotulo="Faturamento no mês" valor={formatarBRL(d.valorMes ?? 0)} nota={`${d.laudosMes ?? 0} laudos`} para="/laudos" />
            <Numero rotulo="A receber" valor={formatarBRL(d.aReceberCentavos ?? 0)} nota={`vencido: ${formatarBRL(d.vencidoCentavos ?? 0)}`} alerta={(d.vencidoCentavos ?? 0) > 0} para="/receber" />
            <Numero rotulo="A pagar" valor={formatarBRL(d.aPagarCentavos ?? 0)} nota={`vencido: ${formatarBRL(d.pagarVencidoCentavos ?? 0)}`} alerta={(d.pagarVencidoCentavos ?? 0) > 0} para="/pagar" />
            <Numero rotulo="Saldo em caixa e bancos" valor={formatarBRL(d.saldoCaixaCentavos ?? 0)} nota={`no mês: +${formatarBRL(d.entradasMesCentavos ?? 0)} / -${formatarBRL(d.saidasMesCentavos ?? 0)}`} alerta={(d.saldoCaixaCentavos ?? 0) < 0} para="/caixa" />
          </div>
          {((d.manuaisARevisar ?? 0) > 0 || (d.pedidosCancelamento ?? 0) > 0 || (d.pendentesAprovacao ?? 0) > 0) && (
            <div className="cartao pilha"><h2>Para resolver</h2>
              {(d.manuaisARevisar ?? 0) > 0 && <Link to="/laudos">{d.manuaisARevisar} laudos com preço digitado aguardam revisão</Link>}
              {(d.pedidosCancelamento ?? 0) > 0 && <Link to="/laudos">{d.pedidosCancelamento} pedidos de cancelamento de laudo</Link>}
              {(d.pendentesAprovacao ?? 0) > 0 && <Link to="/pagar">{d.pendentesAprovacao} contas a pagar aguardando aprovação</Link>}
            </div>
          )}
          {d.serie && <div className="cartao pilha"><h2>Faturamento dos últimos 30 dias</h2><Serie serie={d.serie} /></div>}
          {d.lojas && (
            <div className="cartao pilha"><h2>Lojas da rede</h2>
              <div className="tw"><table>
                <thead><tr><th>Loja</th><th className="num">Laudos no mês</th><th className="num">Faturamento</th><th className="num">A receber</th><th className="num">Vencido</th><th className="num">A pagar</th></tr></thead>
                <tbody>{d.lojas.map((l) => <tr key={l.id}><td><b>{l.nome}</b></td><td className="num">{l.laudosMes}</td><td className="num">{formatarBRL(l.valorMes)}</td><td className="num">{formatarBRL(l.aReceberCentavos)}</td><td className="num" style={{ color: l.vencidoCentavos > 0 ? 'var(--erro)' : undefined }}>{formatarBRL(l.vencidoCentavos)}</td><td className="num">{formatarBRL(l.aPagarCentavos)}</td></tr>)}</tbody>
              </table></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
