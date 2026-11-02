import { BadRequestException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { clienteSchema, decodificarArquivo, formatarBRL, fornecedorSchema, lerCsv, normalizarColuna, paraCentavos, percentualParaBp, precoSchema, temPermissao, type Permissao } from '@ecv/shared';
import { DbService } from '../db/db.service';
import { Acesso, contextoDb, perfilAtivo } from '../common/acesso';
import { auditar } from '../common/auditoria';
import { ClientesService } from '../cadastros/clientes';
import { FornecedoresService } from '../cadastros/fornecedores';
import { hojeSP } from '../caixa/razao';

export type TipoImportacao = 'clientes' | 'fornecedores' | 'precos';
export const TIPOS: Record<TipoImportacao, { titulo: string; permissao: Permissao; colunas: string; exemplo: string }> = {
  clientes: { titulo: 'Clientes', permissao: 'cliente.editar', colunas: 'nome;documento;tipo;email;telefone;periodicidade;prazo_dias;multa;juros', exemplo: 'Auto Center Silva Ltda;11222333000181;PJ;financeiro@silva.com.br;(11) 99999-0000;mensal;10;2;1' },
  fornecedores: { titulo: 'Fornecedores', permissao: 'fornecedor.editar', colunas: 'nome;documento;tipo;email', exemplo: 'Sistema de Laudos Ltda;11444777000161;fornecedor;contato@sistema.com.br' },
  precos: { titulo: 'Preços dos clientes', permissao: 'preco.cadastrar_primeiro', colunas: 'documento;cliente;servico;valor;inicio;motivo', exemplo: '11222333000181;;Vistoria cautelar;180,00;01/01/2026;' },
};
const LIMITE_LINHAS = 2000;

const SINONIMOS: Record<string, string[]> = {
  nome: ['nome', 'razao_social', 'nome_ou_razao_social', 'nome_razao_social'],
  documento: ['documento', 'cpf', 'cnpj', 'cpf_cnpj', 'cnpj_cpf', 'doc'],
  tipo: ['tipo', 'tipo_pessoa'],
  email: ['email', 'e_mail', 'emails', 'email_cobranca', 'emails_cobranca'],
  telefone: ['telefone', 'celular', 'fone'],
  periodicidade: ['periodicidade', 'fatura', 'periodo'],
  prazo_dias: ['prazo_dias', 'prazo', 'prazo_pagamento'],
  multa: ['multa', 'multa_percentual'], juros: ['juros', 'juros_mes', 'juros_ao_mes'],
  cliente: ['cliente', 'nome_cliente'], servico: ['servico', 'nome_servico'], valor: ['valor', 'preco', 'valor_servico'],
  inicio: ['inicio', 'vigencia', 'vigencia_inicio', 'a_partir_de'], motivo: ['motivo'],
};
const OBRIGATORIAS: Record<TipoImportacao, string[][]> = { clientes: [['nome']], fornecedores: [['nome']], precos: [['servico'], ['valor'], ['documento', 'cliente']] };
const soDigitos = (s: string) => s.replace(/\D/g, '');
const dataBr = (t: string): string | null => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(t); if (!m) return null; const iso = m[1]!.length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`; const d = new Date(`${iso}T00:00:00Z`); return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso; };
const TIPO_FORNECEDOR: Record<string, string> = { fornecedor: 'FORNECEDOR', prestador: 'PRESTADOR', concessionaria: 'CONCESSIONARIA', orgao_publico: 'ORGAO_PUBLICO', franqueador: 'FRANQUEADOR' };

export interface LinhaImportacao { linha: number; acao: 'CRIAR' | 'IGNORAR' | 'ERRO' | 'CRIADO'; resumo: string; mensagem?: string }

@Injectable()
export class ImportacaoService {
  constructor(private readonly db: DbService, private readonly clientes: ClientesService, private readonly fornecedores: FornecedoresService) {}

  modelo(tipo: TipoImportacao): string {
    const t = TIPOS[tipo];
    return `﻿${t.colunas}\r\n${t.exemplo}\r\n`;
  }

  /**
   * Lê a planilha (CSV). Sem `aplicar`, só confere e mostra o que aconteceria; com `aplicar`, grava as linhas boas e devolve o motivo das demais.
   * Quem já existe não é alterado (documento igual, ou nome igual quando não há documento).
   */
  async processar(a: Acesso, tipo: TipoImportacao, bytes: Buffer, nomeArquivo: string, aplicar: boolean) {
    const def = TIPOS[tipo];
    const perfil = perfilAtivo(a);
    if (!perfil || !temPermissao(perfil, def.permissao)) throw new ForbiddenException('Você não tem permissão para importar esta planilha.');
    if (bytes.length === 0) throw new UnprocessableEntityException({ mensagem: 'O arquivo está vazio.', campos: { arquivo: 'Arquivo vazio.' } });
    const csv = lerCsv(decodificarArquivo(bytes));
    if (csv.linhas.length === 0) throw new UnprocessableEntityException({ mensagem: 'A planilha não tem linhas de dados abaixo do cabeçalho.', campos: { arquivo: 'Sem linhas de dados.' } });
    if (csv.linhas.length > LIMITE_LINHAS) throw new UnprocessableEntityException({ mensagem: `A planilha tem ${csv.linhas.length} linhas. O máximo é ${LIMITE_LINHAS} por vez: divida em partes.`, campos: { arquivo: 'Planilha grande demais.' } });

    // cabeçalho → coluna padrão
    const indice = new Map<string, number>();
    csv.cabecalho.forEach((h, i) => { const n = normalizarColuna(h); for (const [padrao, nomes] of Object.entries(SINONIMOS)) if (nomes.includes(n) && !indice.has(padrao)) indice.set(padrao, i); });
    for (const grupo of OBRIGATORIAS[tipo]) if (!grupo.some((g) => indice.has(g))) throw new UnprocessableEntityException({ mensagem: `Falta a coluna "${grupo.join('" ou "')}" no cabeçalho da planilha. Baixe o modelo para ver o formato.`, campos: { arquivo: 'Cabeçalho incompleto.' } });
    const v = (l: string[], c: string) => (indice.has(c) ? (l[indice.get(c)!] ?? '').trim() : '');

    return this.db.tenant(contextoDb(a), async () => {
      const saida: LinhaImportacao[] = []; const vistos = new Map<string, number>();
      const existe = async (sql: string, p: unknown[]) => (await this.db.tenant(contextoDb(a), (c) => c.query(sql, p))).rows[0];
      for (const [i, l] of csv.linhas.entries()) {
        const n = i + 2; // linha na planilha (1 = cabeçalho)
        const erro = (mensagem: string, resumo: string): LinhaImportacao => ({ linha: n, acao: 'ERRO', resumo, mensagem });
        try {
          if (tipo === 'clientes' || tipo === 'fornecedores') {
            const nome = v(l, 'nome'); const doc = soDigitos(v(l, 'documento'));
            const resumo = `${nome || '(sem nome)'}${doc ? ` · ${doc}` : ''}`;
            const chave = doc || nome.toLowerCase();
            if (vistos.has(chave)) { saida.push({ linha: n, acao: 'IGNORAR', resumo, mensagem: `Repetido na planilha (já aparece na linha ${vistos.get(chave)}).` }); continue; }
            vistos.set(chave, n);
            const tab = tipo === 'clientes' ? 'cliente' : 'fornecedor';
            const ja = doc ? await existe(`SELECT 1 FROM ${tab} WHERE documento = $1`, [doc]) : await existe(`SELECT 1 FROM ${tab} WHERE lower(nome) = lower($1)`, [nome]);
            if (ja) { saida.push({ linha: n, acao: 'IGNORAR', resumo, mensagem: 'Já cadastrado (não foi alterado).' }); continue; }
            let dados: unknown;
            if (tipo === 'clientes') {
              const tp = v(l, 'tipo').toUpperCase(); const tipoPessoa = tp === 'PF' || tp === 'PJ' ? tp : doc.length === 11 ? 'PF' : 'PJ';
              const multa = v(l, 'multa') ? percentualParaBp(v(l, 'multa')) : undefined; const juros = v(l, 'juros') ? percentualParaBp(v(l, 'juros')) : undefined;
              if (multa === null) { saida.push(erro('Multa inválida. Use um percentual como 2 ou 2,5.', resumo)); continue; }
              if (juros === null) { saida.push(erro('Juros inválidos. Use um percentual ao mês como 1 ou 1,5.', resumo)); continue; }
              const per = normalizarColuna(v(l, 'periodicidade')).toUpperCase(); const prazo = v(l, 'prazo_dias');
              if (per && !['SEMANAL', 'QUINZENAL', 'MENSAL'].includes(per)) { saida.push(erro('Periodicidade deve ser semanal, quinzenal ou mensal.', resumo)); continue; }
              if (prazo && !/^\d{1,3}$/.test(prazo)) { saida.push(erro('Prazo em dias deve ser um número inteiro.', resumo)); continue; }
              const r = clienteSchema.safeParse({ tipoPessoa, documento: doc || undefined, nome, emailsCobranca: v(l, 'email').split(/[\s;|,]+/).filter(Boolean), telefone: v(l, 'telefone') || undefined, periodicidade: per || undefined, prazoDias: prazo ? Number(prazo) : undefined, multaBp: multa ?? undefined, jurosMesBp: juros ?? undefined });
              if (!r.success) { saida.push(erro(r.error.issues[0]!.message, resumo)); continue; }
              dados = r.data;
            } else {
              const tp = normalizarColuna(v(l, 'tipo'));
              if (tp && !TIPO_FORNECEDOR[tp]) { saida.push(erro('Tipo deve ser fornecedor, prestador, concessionária, órgão público ou franqueador.', resumo)); continue; }
              const r = fornecedorSchema.safeParse({ nome, documento: doc || undefined, tipo: tp ? TIPO_FORNECEDOR[tp] : undefined, email: v(l, 'email') || undefined });
              if (!r.success) { saida.push(erro(r.error.issues[0]!.message, resumo)); continue; }
              dados = r.data;
            }
            if (aplicar) { await (tipo === 'clientes' ? this.clientes.criar(a, dados as never) : this.fornecedores.criar(a, dados as never)); saida.push({ linha: n, acao: 'CRIADO', resumo }); } else saida.push({ linha: n, acao: 'CRIAR', resumo });
            continue;
          }
          // preços
          const doc = soDigitos(v(l, 'documento')); const nomeCli = v(l, 'cliente'); const nomeSrv = v(l, 'servico');
          const alvo = doc || nomeCli;
          const resumoBase = `${alvo || '(sem cliente)'} · ${nomeSrv || '(sem serviço)'}`;
          const cli = doc ? await existe(`SELECT id, nome FROM cliente WHERE documento = $1`, [doc]) : nomeCli ? await existe(`SELECT id, nome FROM cliente WHERE lower(nome) = lower($1)`, [nomeCli]) : undefined;
          if (!cli) { saida.push(erro(alvo ? 'Cliente não encontrado. Importe os clientes primeiro.' : 'Informe o documento ou o nome do cliente.', resumoBase)); continue; }
          const srv = await existe(`SELECT id, nome FROM servico WHERE lower(nome) = lower($1) AND status = 'ATIVO'`, [nomeSrv]);
          if (!srv) { saida.push(erro('Serviço não encontrado. Confira o nome em Cadastros › Serviços.', resumoBase)); continue; }
          const valor = paraCentavos(v(l, 'valor'));
          if (valor === null) { saida.push(erro('Valor inválido. Use um número como 180 ou 180,00.', resumoBase)); continue; }
          const ini = v(l, 'inicio') ? dataBr(v(l, 'inicio')) : null;
          if (v(l, 'inicio') && !ini) { saida.push(erro('Data de início inválida. Use dd/mm/aaaa.', resumoBase)); continue; }
          const r = precoSchema.safeParse({ servicoId: srv.id, valorCentavos: valor, vigenciaIni: ini ?? undefined, motivo: v(l, 'motivo') || undefined });
          if (!r.success) { saida.push(erro(r.error.issues[0]!.message, resumoBase)); continue; }
          const chave = `${cli.id}|${srv.id}`;
          if (vistos.has(chave)) { saida.push({ linha: n, acao: 'IGNORAR', resumo: `${cli.nome} · ${srv.nome}`, mensagem: `Repetido na planilha (já aparece na linha ${vistos.get(chave)}).` }); continue; }
          vistos.set(chave, n);
          const resumo = `${cli.nome} · ${srv.nome} · ${formatarBRL(valor)}`;
          const existente = await existe(`SELECT 1 FROM cliente_preco WHERE cliente_id = $1 AND servico_id = $2`, [cli.id, srv.id]);
          if (existente) {
            // já tem preço: só o Administrativo reajusta, com motivo e a partir de hoje ou depois
            if (!a.rede) { saida.push(erro('Este cliente já tem preço para o serviço. Só o Administrativo reajusta.', resumo)); continue; }
            if (!r.data.motivo) { saida.push(erro('Este cliente já tem preço para o serviço: preencha a coluna "motivo" para reajustar.', resumo)); continue; }
            if ((r.data.vigenciaIni ?? hojeSP()) < hojeSP()) { saida.push(erro('O reajuste não pode começar numa data que já passou.', resumo)); continue; }
          }
          if (aplicar) { await this.clientes.definirPreco(a, cli.id, r.data); saida.push({ linha: n, acao: 'CRIADO', resumo, mensagem: existente ? 'Reajuste.' : undefined }); } else saida.push({ linha: n, acao: 'CRIAR', resumo, mensagem: existente ? 'Reajuste de preço.' : undefined });
        } catch (e) {
          const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { mensagem?: string; message?: string } | string | undefined;
          if (!resp) throw e;
          saida.push({ linha: n, acao: 'ERRO', resumo: saida.at(-1)?.linha === n ? saida.at(-1)!.resumo : `linha ${n}`, mensagem: typeof resp === 'string' ? resp : resp.mensagem ?? resp.message ?? 'Não foi possível importar esta linha.' });
        }
      }
      const cont = (x: LinhaImportacao['acao']) => saida.filter((s) => s.acao === x).length;
      const resumo = { total: saida.length, aCriar: cont('CRIAR'), criados: cont('CRIADO'), ignorados: cont('IGNORAR'), erros: cont('ERRO') };
      if (aplicar) {
        await this.db.tenant(contextoDb(a), (c) => auditar(c, a, { acao: 'importacao.aplicada', entidade: 'importacao', entidadeId: tipo, depois: { tipo, arquivo: nomeArquivo.slice(-120), ...resumo } }));
      }
      return { tipo, titulo: def.titulo, aplicado: aplicar, resumo, linhas: saida };
    });
  }
}
void BadRequestException;
