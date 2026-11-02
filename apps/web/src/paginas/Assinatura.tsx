import { useQuery } from '@tanstack/react-query';
import { ROTULO_FORMA_SAAS, formatarBRL } from '@ecv/shared';
import { Aviso, Botao, Campo, Carregando, Pilula, formatarData, useToast } from '@ecv/ui';
import { api } from '../api';
import type { MinhaAssinatura } from '../tipos';

const competencia = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const SITUACAO = { ATIVA: <Pilula tipo="ok">✓ Em dia</Pilula>, INADIMPLENTE: <Pilula tipo="erro">! Pagamento em atraso</Pilula>, CANCELADA: <Pilula>Cancelada</Pilula> } as const;

export function Assinatura() {
  const { avisar } = useToast();
  const q = useQuery({ queryKey: ['assinatura'], queryFn: () => api.get<MinhaAssinatura>('/assinatura') });
  if (q.isLoading) return <Carregando />;
  const d = q.data;
  const a = d?.assinatura;
  if (!d || !a) {
    return (
      <div className="pilha"><div className="cabeca"><div><h1>Assinatura</h1></div></div>
        <Aviso tipo="info">Sua conta ainda não tem uma assinatura registrada. Se você acredita que isso é um engano, fale com a equipe da ECV Cash.</Aviso></div>
    );
  }
  const copiar = async () => { try { await navigator.clipboard.writeText(d.pix!); avisar('Código PIX copiado.'); } catch { avisar('Selecione o código e copie com Ctrl+C.', 'erro'); } };
  const p = d.proxima;
  const extras = Math.max(0, d.empresasAtivas - a.empresasIncluidas);

  return (
    <div className="pilha">
      <div className="cabeca">
        <div><h1>Assinatura</h1><p className="mut">Plano {a.planoNome} · {d.grupoNome}</p></div>
        {SITUACAO[a.status]}
      </div>

      {d.emTeste && <Aviso tipo="info">Você está no período de teste até {formatarData(a.testeAte)}. A primeira mensalidade vence depois dessa data.</Aviso>}
      {a.status === 'INADIMPLENTE' && <Aviso tipo="erro">Há mensalidade vencida há mais de {a.carenciaDias} dias. {a.suspendeEmAtraso ? 'O acesso do seu grupo pode ser suspenso até a regularização.' : 'Regularize para evitar a suspensão do acesso.'}</Aviso>}
      {a.status === 'CANCELADA' && <Aviso tipo="aviso">Esta assinatura foi cancelada. Nada mais será cobrado.</Aviso>}

      {p && a.status !== 'CANCELADA' && (
        <div className="cartao pilha">
          <h2>Próxima mensalidade</h2>
          <div className="grade g3">
            <div><span className="mut peq">Competência</span><div><b>{competencia(p.competencia)}</b></div></div>
            <div><span className="mut peq">Vencimento</span><div><b>{formatarData(p.vencimento)}</b> {p.vencimento < new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) && <Pilula tipo="erro">! Vencida</Pilula>}</div></div>
            <div><span className="mut peq">Valor</span><div><b>{formatarBRL(p.valorCentavos)}</b></div></div>
          </div>
          {d.pix ? (<>
            <Campo rotulo="PIX copia e cola" readOnly value={d.pix} onFocus={(e) => e.currentTarget.select()} dica="Pague pelo aplicativo do seu banco. A baixa é feita pela equipe da ECV Cash após a conferência, em até 1 dia útil." />
            <div><Botao onClick={copiar}>Copiar código PIX</Botao></div>
          </>) : <p className="mut peq">Para pagar, use os dados enviados pela equipe da ECV Cash. A baixa é feita após a conferência do pagamento.</p>}
        </div>
      )}

      <div className="cartao pilha">
        <h2>Seu contrato</h2>
        <div className="grade g4">
          <div><span className="mut peq">Mensalidade base</span><div><b>{formatarBRL(a.valorBaseCentavos)}</b>{a.descontoBp > 0 && <span className="peq mut"> − {(a.descontoBp / 100).toFixed(2).replace('.', ',')}% de desconto</span>}</div></div>
          <div><span className="mut peq">Empresas ativas</span><div><b>{d.empresasAtivas}</b> <span className="peq mut">({a.empresasIncluidas} incluídas)</span></div></div>
          <div><span className="mut peq">Por empresa adicional</span><div><b>{formatarBRL(a.valorEmpresaAdicionalCentavos)}</b></div></div>
          <div><span className="mut peq">Vencimento</span><div><b>Todo dia {a.diaVencimento}</b></div></div>
        </div>
        {extras > 0 && <p className="peq mut">Você tem {extras} empresa(s) além das incluídas. Elas entram na mensalidade seguinte.</p>}
      </div>

      <div className="cartao pilha">
        <h2>Mensalidades</h2>
        <div className="tw"><table>
          <thead><tr><th>Competência</th><th>Vencimento</th><th className="num">Valor</th><th>Situação</th><th>Pagamento</th></tr></thead>
          <tbody>
            {d.cobrancas.map((c) => (
              <tr key={c.id}>
                <td>{competencia(c.competencia)}</td><td>{formatarData(c.vencimento)}</td>
                <td className="num">{formatarBRL(c.valorCentavos)}{c.descontoCentavos > 0 && <div className="peq mut">desconto {formatarBRL(c.descontoCentavos)}</div>}</td>
                <td>{c.status === 'PAGA' ? <Pilula tipo="ok">✓ Paga</Pilula> : c.status === 'CANCELADA' ? <Pilula>Dispensada</Pilula> : c.emAtraso ? <Pilula tipo="erro">! Vencida</Pilula> : <Pilula tipo="aviso">◔ A vencer</Pilula>}</td>
                <td>{c.pagoEm ? `${formatarData(c.pagoEm)} · ${ROTULO_FORMA_SAAS[c.formaPagamento as keyof typeof ROTULO_FORMA_SAAS] ?? c.formaPagamento}` : '—'}</td>
              </tr>))}
            {d.cobrancas.length === 0 && <tr><td colSpan={5} className="vazio">Nenhuma mensalidade gerada ainda.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
