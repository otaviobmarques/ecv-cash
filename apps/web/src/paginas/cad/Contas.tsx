import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { contaFinanceiraSchema, formatarBRL } from '@ecv/shared';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Dialogo, Pilula, Selecao, formatarDataHora, useToast } from '@ecv/ui';
import { api } from '../../api';
import { CampoDinheiro, camposDoErro, checar, hojeIso, mensagemDoErro } from '../../formulario';
import type { ContaFinanceira, Empresa, Eu, PedidoConta } from '../../tipos';

const BANCOS = ['Itaú (341)', 'Bradesco (237)', 'Banco do Brasil (001)', 'Caixa Econômica (104)', 'Santander (033)', 'Sicoob (756)', 'Sicredi (748)', 'Nubank (260)', 'Inter (077)', 'Outro'];
const ROTULO: Record<string, string> = { nome: 'Nome', banco: 'Banco', agencia: 'Agência', conta: 'Conta', tipoConta: 'Tipo da conta', titular: 'Titular', documentoTitular: 'CPF/CNPJ do titular', pixTipo: 'Tipo da chave PIX', pixChave: 'Chave PIX', exibirNaFatura: 'Aparece na fatura', status: 'Situação', saldoInicialCentavos: 'Saldo inicial' };
const SENSIVEIS = ['banco', 'agencia', 'conta', 'tipoConta', 'titular', 'documentoTitular', 'pixTipo', 'pixChave', 'exibirNaFatura'];
const digitos = (s: string) => s.replace(/\D/g, '');
const valorLegivel = (k: string, v: unknown) => (typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : v === null || v === '' ? 'vazio' : k === 'status' ? (v === 'ATIVO' ? 'Ativa' : 'Inativa') : String(v));

export function Contas() {
  const { eu, empresas } = useOutletContext<{ eu: Eu; empresas: Empresa[] }>();
  const contas = useQuery({ queryKey: ['contas'], queryFn: () => api.get<ContaFinanceira[]>('/contas-financeiras') });
  const pedidos = useQuery({ queryKey: ['pedidos-conta'], queryFn: () => api.get<PedidoConta[]>('/contas-financeiras/pedidos?status=PENDENTE') });
  const [dlg, setDlg] = useState<{ conta: ContaFinanceira | null; empresaId?: string } | null>(null);
  const [decisao, setDecisao] = useState<{ pedido: PedidoConta; tipo: 'aprovar' | 'rejeitar' } | null>(null);
  const edita = eu.permissoes.includes('conta_financeira.editar');
  const aprova = eu.permissoes.includes('conta_financeira.aprovar_alteracao');
  const lojasEditaveis = eu.rede ? empresas : empresas.filter((e) => eu.empresas.find((x) => x.id === e.id)?.perfil === 'GERENTE');
  const podeEm = (id: string) => lojasEditaveis.some((l) => l.id === id);
  const loja = (id: string) => empresas.find((e) => e.id === id)?.nomeFantasia ?? 'Loja';

  return (
    <div className="pilha">
      {(pedidos.data?.length ?? 0) > 0 && (
        <div className="cartao pilha" style={{ border: '1.5px solid #B9CEEC' }}>
          <h2>Pedidos de alteração {aprova ? 'aguardando a sua decisão' : 'aguardando o Administrativo'}</h2>
          {pedidos.data!.map((p) => (
            <div key={p.id} className="cartao pilha" style={{ border: '1px solid var(--borda)' }}>
              <div className="cabeca"><div><b>{p.conta ?? 'Conta'}</b> · {loja(p.empresaId)}<div className="peq mut">Pedido de {p.solicitadoPor} em {formatarDataHora(p.criadoEm)}</div></div>
                {aprova && <div className="linha"><Botao pequeno onClick={() => setDecisao({ pedido: p, tipo: 'aprovar' })}>Revisar e aprovar</Botao><Botao variante="sec" pequeno onClick={() => setDecisao({ pedido: p, tipo: 'rejeitar' })}>Rejeitar</Botao></div>}</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{Object.entries(p.dados).map(([k, v]) => <li key={k}>{ROTULO[k] ?? k}: <b>{valorLegivel(k, v)}</b></li>)}</ul>
              {!aprova && <p className="peq mut">A conta continua como estava até o Administrativo aprovar.</p>}
            </div>
          ))}
        </div>
      )}
      <div className="cartao pilha">
        <div className="cabeca"><p className="mut">Caixa e contas bancárias de cada loja. As contas marcadas “aparece na fatura” entram no bloco “Como pagar” de toda fatura da loja, com o QR Code PIX.</p>
          {edita && <Botao onClick={() => setDlg({ conta: null })}>Nova conta</Botao>}</div>
        {contas.isLoading ? <Carregando /> : empresas.map((e) => {
          const lista = contas.data?.filter((c) => c.empresaId === e.id) ?? [];
          return (
            <div key={e.id} className="pilha" style={{ gap: 8 }}>
              <div className="linha entre" style={{ alignItems: 'center' }}><h3>{e.nomeFantasia}</h3>
                {lista.filter((c) => c.exibirNaFatura && c.status === 'ATIVO').length === 0 && <Pilula tipo="aviso">! Nenhuma conta na fatura: as faturas desta loja saem sem dados para pagamento</Pilula>}</div>
              <div className="tw"><table>
                <thead><tr><th>Conta</th><th>Banco, agência e conta</th><th>PIX</th><th>Na fatura</th><th className="num">Saldo inicial</th><th /></tr></thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id}><td><b>{c.nome}</b>{c.status === 'INATIVO' && <> <Pilula>Inativa</Pilula></>}<div className="peq mut">{c.tipo === 'CAIXA' ? 'Caixa' : 'Banco'}</div></td>
                      <td>{c.tipo === 'BANCO' ? <>{c.banco ?? '—'}<div className="peq mut">{c.agencia && c.conta ? `Ag. ${c.agencia} · Conta ${c.conta}` : 'sem agência e conta'}{c.titular ? ` · ${c.titular}` : ''}</div></> : <span className="mut">—</span>}</td>
                      <td>{c.pixChave ? <>{c.pixChave}<div className="peq mut">{c.pixTipo}</div></> : <span className="mut">—</span>}</td>
                      <td>{c.pedidoPendente ? <Pilula tipo="info">◔ Aguardando Administrativo</Pilula> : c.exibirNaFatura ? <Pilula tipo="ok">✓ Aparece na fatura</Pilula> : <Pilula>Não aparece</Pilula>}</td>
                      <td className="num">{formatarBRL(Number(c.saldoInicialCentavos))}</td>
                      <td>{edita && podeEm(c.empresaId) && <Botao variante="sec" pequeno disabled={!!c.pedidoPendente} onClick={() => setDlg({ conta: c })}>Editar</Botao>}</td></tr>
                  ))}
                  {lista.length === 0 && <tr><td colSpan={6} className="vazio">Nenhuma conta cadastrada nesta loja.</td></tr>}
                </tbody>
              </table></div>
            </div>
          );
        })}
        {!edita && <p className="peq mut">Seu perfil consulta as contas. Quem cadastra é o Administrativo ou o Gerente da loja.</p>}
      </div>
      <FormConta dlg={dlg} lojas={lojasEditaveis} eu={eu} onFechar={() => setDlg(null)} />
      <FormDecisao d={decisao} onFechar={() => setDecisao(null)} />
    </div>
  );
}

type Estado = { empresaId: string; nome: string; tipo: 'CAIXA' | 'BANCO'; saldo: number | null; dataSaldo: string; banco: string; agencia: string; conta: string; tipoConta: string; titular: string; documentoTitular: string; pixTipo: string; pixChave: string; exibir: boolean; senha: string };
const vazio = (empresaId = ''): Estado => ({ empresaId, nome: '', tipo: 'BANCO', saldo: 0, dataSaldo: hojeIso(), banco: '', agencia: '', conta: '', tipoConta: 'CORRENTE', titular: '', documentoTitular: '', pixTipo: '', pixChave: '', exibir: false, senha: '' });
const doConta = (c: ContaFinanceira): Estado => ({ empresaId: c.empresaId, nome: c.nome, tipo: c.tipo, saldo: Number(c.saldoInicialCentavos), dataSaldo: c.dataSaldoInicial.slice(0, 10), banco: c.banco ?? '', agencia: c.agencia ?? '', conta: c.conta ?? '', tipoConta: c.tipoConta ?? 'CORRENTE', titular: c.titular ?? '', documentoTitular: c.documentoTitular ?? '', pixTipo: c.pixTipo ?? '', pixChave: c.pixChave ?? '', exibir: c.exibirNaFatura, senha: '' });

function FormConta({ dlg, lojas, eu, onFechar }: { dlg: { conta: ContaFinanceira | null; empresaId?: string } | null; lojas: Empresa[]; eu: Eu; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const ed = dlg?.conta ?? null;
  const [f, setF] = useState<Estado>(vazio());
  const [aberto, setAberto] = useState<typeof dlg>(null);
  const [chave, setChave] = useState(0);
  if (dlg !== aberto) { setAberto(dlg); setChave((k) => k + 1); setF(ed ? doConta(ed) : vazio(dlg?.empresaId ?? (lojas.length === 1 ? lojas[0]!.id : ''))); }
  const [erros, setErros] = useState<Record<string, string>>({}); const [erro, setErro] = useState<string | null>(null);

  const mudancas = (): Record<string, unknown> => {
    if (!ed) return {};
    const o = doConta(ed); const m: Record<string, unknown> = {};
    const txt = (k: string, novo: string, velho: string, norm: (s: string) => string = (s) => s.trim()) => { if (norm(novo) !== norm(velho)) m[k] = norm(novo) === '' ? null : novo.trim(); };
    if (f.nome.trim() !== o.nome) m.nome = f.nome.trim();
    if (f.saldo !== o.saldo && f.saldo !== null) m.saldoInicialCentavos = f.saldo;
    if (f.tipo === 'BANCO') {
      txt('banco', f.banco, o.banco); txt('agencia', f.agencia, o.agencia); txt('conta', f.conta, o.conta); txt('titular', f.titular, o.titular);
      txt('documentoTitular', f.documentoTitular, o.documentoTitular, digitos); txt('pixChave', f.pixChave, o.pixChave);
      if (f.tipoConta !== o.tipoConta) m.tipoConta = f.tipoConta;
      if (f.pixTipo !== o.pixTipo) m.pixTipo = f.pixTipo || null;
    }
    if (f.exibir !== o.exibir) m.exibirNaFatura = f.exibir;
    return m;
  };
  const m = mudancas();
  const sensivelMudou = Object.keys(m).some((k) => SENSIVEIS.includes(k));
  const precisaConfirmar = ed ? (ed.exibirNaFatura || f.exibir) && sensivelMudou : f.exibir;
  const pedeSenha = eu.rede && (precisaConfirmar || (!!ed && ed.exibirNaFatura));

  const salvar = useMutation({
    mutationFn: (v: unknown) => (ed ? api.patch<{ pedido: { id: string } | null }>(`/contas-financeiras/${ed.id}`, v) : api.post<{ pedido: { id: string } | null }>('/contas-financeiras', v)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['contas'] }); qc.invalidateQueries({ queryKey: ['pedidos-conta'] });
      avisar(r.pedido ? 'Pedido enviado ao Administrativo. A fatura só muda depois da aprovação.' : ed ? 'Conta atualizada.' : 'Conta cadastrada.'); onFechar();
    },
    onError: (e) => { setErro(mensagemDoErro(e)); setErros(camposDoErro(e)); },
  });
  const enviar = () => {
    setErro(null);
    if (ed) {
      if (Object.keys(m).length === 0) { setErro('Nada mudou.'); return; }
      salvar.mutate({ ...m, ...(f.senha ? { senha: f.senha } : {}) }); return;
    }
    const r = checar(contaFinanceiraSchema, {
      empresaId: f.empresaId, nome: f.nome, tipo: f.tipo, saldoInicialCentavos: f.saldo ?? 0, dataSaldoInicial: f.dataSaldo,
      ...(f.tipo === 'BANCO' ? { banco: f.banco, agencia: f.agencia, conta: f.conta, tipoConta: f.tipoConta, titular: f.titular, documentoTitular: f.documentoTitular, pixTipo: f.pixTipo, pixChave: f.pixChave } : {}),
      exibirNaFatura: f.tipo === 'BANCO' && f.exibir, senha: f.senha || undefined,
    });
    if (r.erros) { setErros(r.erros); return; }
    setErros({}); salvar.mutate(r.dados);
  };
  const set = (p: Partial<Estado>) => setF({ ...f, ...p });
  return (
    <Dialogo aberto={!!dlg} onFechar={onFechar} titulo={ed ? `Editar ${ed.nome}` : 'Nova conta'} lateral>
      <div className="pilha" key={chave}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!ed && <Selecao rotulo="Loja" obrigatorio value={f.empresaId} onChange={(e) => set({ empresaId: e.target.value })} erro={erros.empresaId}><option value="">Escolha a loja</option>{lojas.map((l) => <option key={l.id} value={l.id}>{l.nomeFantasia}</option>)}</Selecao>}
        <div className="grade g2"><Campo rotulo="Nome da conta" obrigatorio value={f.nome} onChange={(e) => set({ nome: e.target.value })} erro={erros.nome} placeholder="Ex.: Itaú principal" />
          <Selecao rotulo="Tipo" disabled={!!ed} value={f.tipo} onChange={(e) => set({ tipo: e.target.value as 'CAIXA' | 'BANCO', exibir: false })}><option value="BANCO">Conta bancária</option><option value="CAIXA">Caixa da loja</option></Selecao></div>
        {!ed && <div className="grade g2"><CampoDinheiro rotulo="Saldo inicial (R$)" centavos={f.saldo} onChange={(c) => set({ saldo: c })} erro={erros.saldoInicialCentavos} /><Campo rotulo="Saldo de" type="date" value={f.dataSaldo} onChange={(e) => set({ dataSaldo: e.target.value })} erro={erros.dataSaldoInicial} /></div>}
        {f.tipo === 'BANCO' && (
          <>
            <h3>Dados para o cliente pagar</h3>
            <Selecao rotulo="Banco" value={f.banco} onChange={(e) => set({ banco: e.target.value })} erro={erros.banco}><option value="">Escolha o banco</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}{f.banco && !BANCOS.includes(f.banco) && <option>{f.banco}</option>}</Selecao>
            <div className="grade g2"><Campo rotulo="Agência" inputMode="numeric" value={f.agencia} onChange={(e) => set({ agencia: e.target.value })} erro={erros.agencia} /><Campo rotulo="Conta com dígito" value={f.conta} onChange={(e) => set({ conta: e.target.value })} erro={erros.conta} /></div>
            <Selecao rotulo="Tipo da conta" value={f.tipoConta} onChange={(e) => set({ tipoConta: e.target.value })}><option value="CORRENTE">Corrente</option><option value="POUPANCA">Poupança</option><option value="PAGAMENTO">Pagamento</option></Selecao>
            <Campo rotulo="Titular" value={f.titular} onChange={(e) => set({ titular: e.target.value })} erro={erros.titular} />
            <Campo rotulo="CPF ou CNPJ do titular" inputMode="numeric" value={f.documentoTitular} onChange={(e) => set({ documentoTitular: e.target.value })} erro={erros.documentoTitular} />
            <div className="grade g2"><Selecao rotulo="Tipo da chave PIX" value={f.pixTipo} onChange={(e) => set({ pixTipo: e.target.value })} erro={erros.pixTipo}><option value="">Sem PIX</option><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option><option value="EMAIL">E-mail</option><option value="TELEFONE">Telefone</option><option value="ALEATORIA">Aleatória</option></Selecao>
              <Campo rotulo="Chave PIX" value={f.pixChave} onChange={(e) => set({ pixChave: e.target.value })} erro={erros.pixChave} dica="Com a chave, a fatura mostra o QR Code PIX." /></div>
            <label className="check"><input type="checkbox" checked={f.exibir} onChange={(e) => set({ exibir: e.target.checked })} />Mostrar esta conta na fatura (bloco “Como pagar”)</label>
            {erros.exibirNaFatura && <small style={{ color: 'var(--erro)' }}>{erros.exibirNaFatura}</small>}
          </>
        )}
        {precisaConfirmar && !eu.rede && <Aviso tipo="aviso">Esta conta aparece na fatura. A alteração <b>vai como pedido ao Administrativo</b> e a fatura continua como está até ele aprovar.</Aviso>}
        {precisaConfirmar && eu.rede && <Aviso tipo="aviso">Esta mudança altera para onde o cliente paga. Confirme com a sua senha. O Administrativo e o financeiro da loja serão avisados.</Aviso>}
        {pedeSenha && <Campo rotulo="Sua senha" type="password" autoComplete="current-password" value={f.senha} onChange={(e) => set({ senha: e.target.value })} erro={erros.senha} dica="Só é pedida quando a mudança afeta a fatura." />}
        <div className="linha"><Botao carregando={salvar.isPending} onClick={enviar}>{ed ? (precisaConfirmar && !eu.rede ? 'Enviar pedido' : 'Salvar') : (precisaConfirmar && !eu.rede ? 'Cadastrar e pedir aprovação' : 'Cadastrar conta')}</Botao>
          {ed && eu.rede === false && ed.exibirNaFatura && null}
          {ed && <Botao variante="sec" onClick={() => { setErro(null); salvar.mutate({ status: ed.status === 'ATIVO' ? 'INATIVO' : 'ATIVO', ...(f.senha ? { senha: f.senha } : {}) }); }}>{ed.status === 'ATIVO' ? 'Inativar conta' : 'Reativar conta'}</Botao>}</div>
      </div>
    </Dialogo>
  );
}

function FormDecisao({ d, onFechar }: { d: { pedido: PedidoConta; tipo: 'aprovar' | 'rejeitar' } | null; onFechar: () => void }) {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [senha, setSenha] = useState(''); const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () => api.post(`/contas-financeiras/pedidos/${d!.pedido.id}/${d!.tipo === 'aprovar' ? 'aprovar' : 'rejeitar'}`, d!.tipo === 'aprovar' ? { senha } : { motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contas'] }); qc.invalidateQueries({ queryKey: ['pedidos-conta'] }); avisar(d!.tipo === 'aprovar' ? 'Alteração aprovada e aplicada.' : 'Pedido rejeitado.'); setSenha(''); setMotivo(''); setErro(null); onFechar(); },
    onError: (e) => setErro(mensagemDoErro(e)),
  });
  return (
    <Dialogo aberto={!!d} onFechar={onFechar} titulo={d?.tipo === 'aprovar' ? 'Aprovar alteração' : 'Rejeitar pedido'}>
      <div className="pilha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p><b>{d?.pedido.conta}</b>, pedido de {d?.pedido.solicitadoPor}:</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>{d && Object.entries(d.pedido.dados).map(([k, v]) => <li key={k}>{ROTULO[k] ?? k}: <b>{valorLegivel(k, v)}</b></li>)}</ul>
        {d?.tipo === 'aprovar' ? (<><Aviso tipo="aviso">Depois de aprovar, os clientes passam a pagar pelos dados novos. Confira com o banco antes.</Aviso>
          <Campo rotulo="Sua senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></>)
          : <AreaTexto rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} dica="Mínimo de 5 caracteres. Fica no log." />}
        <Botao carregando={salvar.isPending} disabled={d?.tipo === 'aprovar' ? !senha : motivo.trim().length < 5} variante={d?.tipo === 'aprovar' ? 'primario' : 'perigo'} onClick={() => { setErro(null); salvar.mutate(); }}>{d?.tipo === 'aprovar' ? 'Aprovar e aplicar' : 'Rejeitar pedido'}</Botao>
      </div>
    </Dialogo>
  );
}
