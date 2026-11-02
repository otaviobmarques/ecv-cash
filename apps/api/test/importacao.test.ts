import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { cliente, criarCenario, subirApp, unico } from './helpers';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const amanha = () => new Date(Date.parse(hoje()) + 86_400_000).toISOString().slice(0, 10).split('-').reverse().join('/');
const cnpj = (base: number) => { const d = String(base).padStart(8, '0').split('').map(Number).concat([0, 0, 0, 1]); const dv = (a: number[], p: number[]) => { const r = a.reduce((s, n, i) => s + n * p[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); const d2 = dv([...d, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return [...d, d1, d2].join(''); };

describe('importação por planilha', () => {
  let app: INestApplication; let cen: Awaited<ReturnType<typeof criarCenario>>;
  type C = ReturnType<typeof cliente>;
  let adm: C, ger: C, fin: C, vis: C, admB: C;
  const entrar = async (nome: string) => { const c = cliente(app); expect((await c.login(cen.mail(nome))).status, nome).toBe(200); return c; };
  const enviar = (c: C, tipo: string, conteudo: string | Buffer, aplicar = false) => c.agent.post(`/importacao/${tipo}${aplicar ? '?aplicar=1' : ''}`).set('Origin', 'http://app.test').attach('arquivo', Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8'), 'planilha.csv');
  const s = unico().slice(0, 4); const base = 20000000 + Math.floor(Math.random() * 1000000);
  const A = cnpj(base), B = cnpj(base + 7);
  const acoes = (r: { body: { linhas: { acao: string }[] } }) => r.body.linhas.map((l) => l.acao);

  beforeAll(async () => {
    ({ app } = await subirApp());
    cen = await criarCenario((app as never as { get: (t: unknown) => never }).get((await import('../src/db/db.service')).DbService));
    [adm, ger, fin, vis, admB] = (await Promise.all(['adminA', 'gerenteA1', 'finA1', 'visA1', 'adminB'].map(entrar))) as [C, C, C, C, C];
  });
  afterAll(() => app.close());

  describe('modelo', () => {
    it('cada tipo tem um modelo em CSV com BOM e uma linha de exemplo', async () => {
      for (const t of ['clientes', 'fornecedores', 'precos']) {
        const r = await ger.get(`/importacao/modelo/${t}`);
        expect(r.status).toBe(200); expect(r.headers['content-disposition']).toContain(`modelo-${t}.csv`);
        expect(r.text.startsWith('﻿')).toBe(true); expect(r.text.split('\r\n').length).toBeGreaterThanOrEqual(2);
      }
      expect((await ger.get('/importacao/modelo/outro')).status).toBe(422);
    });
  });

  describe('clientes', () => {
    const planilha = `nome;documento;tipo;email;telefone;periodicidade;prazo_dias;multa;juros\r\nAuto Center ${s} Ltda;${A};PJ;fin@${s}.test financeiro2@${s}.test;(11) 99999-0000;quinzenal;15;2,5;1,5\r\nMaria Souza ${s};52998224725;;;;;;;\r\nCNPJ Errado ${s};11111111111112;PJ;;;;;;\r\nAuto Center ${s} Ltda;${A};PJ;;;;;;\r\nFulano ${s};;;;;diario;;;\r\nSem Email Ruim ${s};;;nao-e-email;;;;;\r\n`;
    it('a prévia confere tudo e não grava nada', async () => {
      const r = await ger.agent.post('/importacao/clientes').set('Origin', 'http://app.test').attach('arquivo', Buffer.from(planilha), 'c.csv');
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ aplicado: false, resumo: { total: 6, aCriar: 2, criados: 0, ignorados: 1, erros: 3 } });
      expect(acoes(r)).toEqual(['CRIAR', 'CRIAR', 'ERRO', 'IGNORAR', 'ERRO', 'ERRO']);
      expect(r.body.linhas[2].mensagem).toBe('CNPJ inválido.'); expect(r.body.linhas[3].mensagem).toMatch(/Repetido na planilha \(já aparece na linha 2\)/); expect(r.body.linhas[4].mensagem).toMatch(/Periodicidade/);
      expect(((await ger.get(`/clientes?busca=${s}`)).body as unknown[]).length).toBe(0);
    });
    it('aplicar grava as linhas boas, com as regras da planilha; os erros ficam para corrigir', async () => {
      const r = await enviar(ger, 'clientes', planilha, true);
      expect(r.body).toMatchObject({ aplicado: true, resumo: { criados: 2, ignorados: 1, erros: 3 } });
      const lista = (await ger.get(`/clientes?busca=${s}`)).body as { id: string; nome: string }[];
      expect(lista.map((c) => c.nome).sort()).toEqual([`Auto Center ${s} Ltda`, `Maria Souza ${s}`]);
      const det = (await ger.get(`/clientes/${lista.find((c) => c.nome.startsWith('Auto'))!.id}`)).body;
      expect(det).toMatchObject({ tipoPessoa: 'PJ', periodicidade: 'QUINZENAL', prazoDias: 15, multaBp: 250, jurosMesBp: 150, emailsCobranca: [`fin@${s}.test`, `financeiro2@${s}.test`] });
      expect((await ger.get(`/clientes/${lista.find((c) => c.nome.startsWith('Maria'))!.id}`)).body.tipoPessoa).toBe('PF'); // inferido pelo CPF
    });
    it('importar de novo não duplica nem altera: tudo "já cadastrado"', async () => {
      const r = await enviar(ger, 'clientes', planilha, true);
      expect(r.body.resumo).toMatchObject({ criados: 0, ignorados: 3, erros: 3 });
      expect(r.body.linhas[0].mensagem).toBe('Já cadastrado (não foi alterado).');
    });
    it('aceita planilha do Excel antigo (Windows-1252, separador ;)', async () => {
      const latin = Buffer.from(`nome;documento\r\nJoão Conceição ${s};\r\n`, 'latin1');
      const r = await enviar(ger, 'clientes', latin, true);
      expect(r.body.resumo.criados).toBe(1);
      expect(((await ger.get(`/clientes?busca=Conceição ${s}`)).body as { nome: string }[])[0]!.nome).toBe(`João Conceição ${s}`);
    });
    it('recusa arquivo sem a coluna obrigatória, vazio, grande demais e quem não pode', async () => {
      expect((await enviar(ger, 'clientes', 'documento;email\r\n1;2\r\n')).body.mensagem).toMatch(/Falta a coluna "nome"/);
      expect((await enviar(ger, 'clientes', 'nome\r\n')).status).toBe(422);
      expect((await enviar(ger, 'clientes', `nome\r\n${Array.from({ length: 2001 }, (_, i) => `C${i}`).join('\r\n')}\r\n`)).status).toBe(422);
      expect((await ger.agent.post('/importacao/clientes').set('Origin', 'http://app.test')).status).toBe(422);
      expect((await fin.agent.post('/importacao/clientes').set('Origin', 'http://app.test').attach('arquivo', Buffer.from('nome\r\nX Y\r\n'), 'a.csv')).status).toBe(403);
      expect((await enviar(vis, 'clientes', 'nome\r\nXY Z\r\n')).status).toBe(403);
    });
    it('os clientes importados ficam só no grupo de quem importou', async () => {
      expect(((await admB.get(`/clientes?busca=${s}`)).body as unknown[]).length).toBe(0);
    });
  });

  describe('fornecedores', () => {
    it('importa com os tipos do cadastro; o Financeiro também pode', async () => {
      const p = `nome;documento;tipo;email\r\nDetran ${s};;órgão público;\r\nSistema ${s} Ltda;${B};fornecedor;contato@${s}.test\r\nRoyalties ${s};;franqueador;\r\nTipo Ruim ${s};;marciano;\r\n`;
      const r = await enviar(fin, 'fornecedores', p, true);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.resumo).toMatchObject({ criados: 3, erros: 1 });
      const lista = (await fin.get('/fornecedores')).body as { nome: string; tipo: string }[];
      expect(lista.find((f) => f.nome === `Detran ${s}`)!.tipo).toBe('ORGAO_PUBLICO'); expect(lista.find((f) => f.nome === `Royalties ${s}`)!.tipo).toBe('FRANQUEADOR');
    });
  });

  describe('preços', () => {
    let servico: string;
    beforeAll(async () => { servico = (await adm.post('/servicos', { nome: `Cautelar ${s}` })).body.id; await adm.post('/servicos', { nome: `Transferência ${s}` }); });
    it('primeiro preço por documento ou por nome; erros claros para cliente, serviço, valor e data', async () => {
      const p = `documento;cliente;servico;valor;inicio\r\n${A};;Cautelar ${s};180,00;01/01/2026\r\n;Maria Souza ${s};cautelar ${s};R$ 150;\r\n${A};;Serviço Que Não Existe;100;\r\n99999999999;;Cautelar ${s};100;\r\n${A};;Transferência ${s};abc;\r\n${A};;Transferência ${s};120;31/02/2026\r\n`;
      const r = await ger.agent.post('/importacao/precos').set('Origin', 'http://app.test').attach('arquivo', Buffer.from(p), 'p.csv');
      expect(r.body.resumo).toMatchObject({ aCriar: 2, erros: 4 });
      expect(r.body.linhas.map((l: { mensagem?: string }) => l.mensagem)).toEqual([undefined, undefined, 'Serviço não encontrado. Confira o nome em Cadastros › Serviços.', 'Cliente não encontrado. Importe os clientes primeiro.', 'Valor inválido. Use um número como 180 ou 180,00.', 'Data de início inválida. Use dd/mm/aaaa.']);
      const ap = await enviar(ger, 'precos', p, true);
      expect(ap.body.resumo).toMatchObject({ criados: 2, erros: 4 });
      const cli = ((await ger.get(`/clientes?busca=Maria Souza ${s}`)).body as { id: string }[])[0]!;
      expect(((await ger.get(`/precos/vigente?clienteId=${cli.id}&servicoId=${servico}`)).body.preco).valorCentavos).toBe(15000);
    });
    it('cliente que já tem preço: o Gerente não reajusta; o Administrativo precisa de motivo e data de hoje em diante', async () => {
      const semMotivo = `documento;servico;valor;inicio\r\n${A};Cautelar ${s};195,50;${amanha()}\r\n`;
      expect((await enviar(ger, 'precos', semMotivo)).body.linhas[0].mensagem).toBe('Este cliente já tem preço para o serviço. Só o Administrativo reajusta.');
      expect((await enviar(adm, 'precos', semMotivo)).body.linhas[0].mensagem).toMatch(/preencha a coluna "motivo"/);
      const ok = `documento;servico;valor;inicio;motivo\r\n${A};Cautelar ${s};195,50;${amanha()};Reajuste anual\r\n`;
      expect((await enviar(adm, 'precos', ok)).body.linhas[0]).toMatchObject({ acao: 'CRIAR', mensagem: 'Reajuste de preço.' });
      expect((await enviar(adm, 'precos', ok, true)).body.resumo.criados).toBe(1);
      const passado = `documento;servico;valor;inicio;motivo\r\n${A};Cautelar ${s};300;01/01/2026;Retroativo\r\n`;
      expect((await enviar(adm, 'precos', passado)).body.linhas[0].mensagem).toMatch(/já passou/);
    });
  });

  it('cada importação aplicada fica na auditoria', async () => {
    const itens = (await adm.get('/auditoria?limite=200')).body.itens as { acao: string; depois: { tipo: string; criados: number } }[];
    const imp = itens.filter((i) => i.acao === 'importacao.aplicada');
    expect(imp.map((i) => i.depois.tipo)).toEqual(expect.arrayContaining(['clientes', 'fornecedores', 'precos']));
  });
});
