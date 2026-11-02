import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Aviso, Botao, Pilula, Selecao, useToast } from '@ecv/ui';
import { API_BASE, enviarArquivo } from '../../api';
import { mensagemDoErro } from '../../formulario';

type Tipo = 'clientes' | 'fornecedores' | 'precos';
interface Retorno { tipo: Tipo; aplicado: boolean; resumo: { total: number; aCriar: number; criados: number; ignorados: number; erros: number }; linhas: { linha: number; acao: 'CRIAR' | 'IGNORAR' | 'ERRO' | 'CRIADO'; resumo: string; mensagem?: string }[] }
const TITULO: Record<Tipo, string> = { clientes: 'Clientes', fornecedores: 'Fornecedores', precos: 'Preços dos clientes' };
const DICA: Record<Tipo, string> = {
  clientes: 'Colunas: nome (obrigatória), documento, tipo (PF ou PJ), email, telefone, periodicidade (semanal, quinzenal ou mensal), prazo_dias, multa (%), juros (% ao mês). Quem já está cadastrado (mesmo documento) não é alterado.',
  fornecedores: 'Colunas: nome (obrigatória), documento, tipo (fornecedor, prestador, concessionária, órgão público ou franqueador), email.',
  precos: 'Colunas: documento ou cliente (nome igual ao cadastro), servico (nome igual ao cadastrado), valor, inicio (dd/mm/aaaa, opcional) e motivo. Importe os clientes antes. Reajuste de preço existente é só do Administrativo e pede o motivo.',
};

export function Importar() {
  const qc = useQueryClient(); const { avisar } = useToast();
  const [tipo, setTipo] = useState<Tipo>('clientes'); const [arquivo, setArquivo] = useState<File | null>(null);
  const [r, setR] = useState<Retorno | null>(null); const [erro, setErro] = useState<string | null>(null);
  const enviar = useMutation({
    mutationFn: (aplicar: boolean) => enviarArquivo<Retorno>(`/importacao/${tipo}${aplicar ? '?aplicar=1' : ''}`, arquivo!),
    onSuccess: (x) => { setR(x); setErro(null); if (x.aplicado) { avisar(`${x.resumo.criados} cadastrados${x.resumo.erros ? `, ${x.resumo.erros} com problema` : ''}.`); qc.invalidateQueries({ queryKey: ['clientes'] }); qc.invalidateQueries({ queryKey: ['fornecedores'] }); qc.invalidateQueries({ queryKey: ['cliente'] }); } },
    onError: (e) => { setErro(mensagemDoErro(e)); setR(null); },
  });
  return (
    <div className="cartao pilha">
      <p className="mut">Traga sua base de uma planilha. Salve o arquivo do Excel como <b>CSV</b> ("CSV (separado por vírgulas)" ou "CSV UTF-8"). Primeiro o sistema confere tudo e mostra o que vai acontecer; só grava quando você confirmar.</p>
      <div className="linha">
        <Selecao rotulo="O que importar" value={tipo} onChange={(e) => { setTipo(e.target.value as Tipo); setR(null); setErro(null); }}>{(Object.keys(TITULO) as Tipo[]).map((k) => <option key={k} value={k}>{TITULO[k]}</option>)}</Selecao>
        <a className="btn sec" href={`${API_BASE}/importacao/modelo/${tipo}`}>Baixar modelo (CSV)</a>
      </div>
      <p className="peq mut">{DICA[tipo]}</p>
      <div className="fld"><label htmlFor="arquivo-importacao">Planilha (CSV, até 5 MB e 2.000 linhas)</label><input id="arquivo-importacao" type="file" accept=".csv,text/csv" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setR(null); setErro(null); }} /></div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="linha"><Botao disabled={!arquivo} carregando={enviar.isPending} onClick={() => enviar.mutate(false)}>Conferir planilha</Botao>
        {r && !r.aplicado && r.resumo.aCriar > 0 && <Botao carregando={enviar.isPending} onClick={() => enviar.mutate(true)}>Importar {r.resumo.aCriar} {r.resumo.aCriar === 1 ? 'linha' : 'linhas'}</Botao>}</div>
      {r && (
        <>
          <Aviso tipo={r.resumo.erros ? 'aviso' : 'ok'}>
            {r.aplicado ? `Pronto: ${r.resumo.criados} cadastrados` : `Conferido: ${r.resumo.aCriar} para cadastrar`}, {r.resumo.ignorados} já existiam ou estavam repetidos, {r.resumo.erros} com problema{r.resumo.erros ? '. Corrija essas linhas na planilha e importe de novo: as boas não se repetem.' : '.'}
          </Aviso>
          <div className="tw"><table>
            <thead><tr><th>Linha</th><th>Registro</th><th>Resultado</th></tr></thead>
            <tbody>
              {r.linhas.map((l) => <tr key={l.linha}><td>{l.linha}</td><td>{l.resumo}</td>
                <td>{l.acao === 'ERRO' ? <Pilula tipo="erro">✕ Problema</Pilula> : l.acao === 'IGNORAR' ? <Pilula>Ignorada</Pilula> : l.acao === 'CRIADO' ? <Pilula tipo="ok">✓ Cadastrado</Pilula> : <Pilula tipo="info">Será cadastrado</Pilula>}{l.mensagem && <div className="peq mut">{l.mensagem}</div>}</td></tr>)}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}
