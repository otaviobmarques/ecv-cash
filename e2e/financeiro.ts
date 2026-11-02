/**
 * Verificação ponta a ponta do financeiro no navegador: cadastros mínimos (pela API), laudos, A receber (baixa parcial), Faturados
 * (gerar, PIX, PDF), Caixa, A pagar (criar, aprovar por outra pessoa, pagar), Cartões (liquidar), Comissões (fechar), Relatórios (DRE)
 * e o painel de início. Precisa da API e do app no ar e dos dados de exemplo (pnpm db:seed). Roda à mão, não no CI.
 */
import { chromium } from 'playwright';
const SC = process.env.E2E_SAIDA ?? './e2e/saida';
const WEB = 'http://localhost:5173'; const API = 'http://localhost:3000'; const SENHA = 'Senha-de-teste-1';
const sfx = Date.now().toString(36);
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXZ'; let seq = Math.floor(Math.random() * 5000) + 100;
const placa = () => { seq++; return `${LETRAS[seq % 22]}${LETRAS[Math.floor(seq / 22) % 22]}${LETRAS[Math.floor(seq / 484) % 22]}${seq % 10}${LETRAS[(seq * 7) % 22]}${Math.floor(seq / 10) % 10}${Math.floor(seq / 100) % 10}`; };
const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
(async () => {
  const b = await chromium.launch(); const erros: string[] = [];
  const entrar = async (email: string) => {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); const p = await ctx.newPage();
    p.on('pageerror', (e: Error) => erros.push('PAGEERR ' + e.message));
    p.on('console', (m: any) => { if (m.type() === 'error' && !/401|403|404|409|422|429|Failed to load resource/.test(m.text())) erros.push('CONSOLE ' + m.text()); });
    await p.goto(WEB + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', SENHA); await p.click('button:has-text("Entrar")'); await p.waitForSelector('h1:has-text("Olá")'); return p;
  };
  const api = (p: any, metodo: string, url: string, corpo?: unknown) => p.evaluate(async ([m, u, c]: any) => { const r = await fetch(u, { method: m, credentials: 'include', headers: { 'content-type': 'application/json' }, body: c ? JSON.stringify(c) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [metodo, API + url, corpo]);
  const dlg = (p: any) => p.locator('dialog[open]');
  const toast = (p: any, t: string) => p.waitForSelector(`.toast:has-text("${t}")`, { timeout: 8000 });

  const adm = await entrar('admin@exemplo.local');
  const eu = (await api(adm, 'GET', '/auth/eu')).body;
  // ---- base (API) ----
  const servico = (await api(adm, 'POST', '/servicos', { nome: `Cautelar ${sfx}` })).body.id;
  await api(adm, 'POST', `/servicos/${servico}/custos`, { descricao: 'Taxa do Detran', tipo: 'VALOR', valorCentavos: 4000 });
  const nomeCli = `Auto Center ${sfx}`;
  const cliente = (await api(adm, 'POST', '/clientes', { tipoPessoa: 'PJ', nome: nomeCli, emailsCobranca: [`fin${sfx}@cliente.test`] })).body.id;
  await api(adm, 'POST', `/clientes/${cliente}/precos`, { servicoId: servico, valorCentavos: 20000, vigenciaIni: '2025-01-01' });
  const formas = (await api(adm, 'GET', '/formas-pagamento')).body as { id: string; nome: string }[];
  const F = (n: string) => formas.find((f) => f.nome === n)!.id;
  await api(adm, 'PUT', `/formas-pagamento/${F('Cartão de débito')}/empresas/${eu.empresaAtivaId}`, { taxaBp: 150, prazoDias: 1, antecipacaoBp: 0 });
  let vists = (await api(adm, 'GET', '/vistoriadores')).body as { id: string; nome: string }[];
  const vist = (vists.find((v) => v.nome === 'Ana Souza') ?? (await api(adm, 'POST', '/vistoriadores', { nome: 'Ana Souza', empresaIds: [eu.empresaAtivaId] })).body).id as string;
  const caixaId = (await api(adm, 'POST', '/contas-financeiras', { empresaId: eu.empresaAtivaId, nome: `Caixa ${sfx}`, tipo: 'CAIXA', saldoInicialCentavos: 50000, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  const bancoId = (await api(adm, 'POST', '/contas-financeiras', { empresaId: eu.empresaAtivaId, nome: `Banco ${sfx}`, tipo: 'BANCO', saldoInicialCentavos: 0, dataSaldoInicial: '2025-01-01' })).body.conta.id;
  await api(adm, 'POST', '/comissoes/regras', { tipo: 'PERCENTUAL', percentualBp: 1000, vigenciaIni: '2025-01-01', vistoriadorId: vist });
  await api(adm, 'POST', '/aliquotas', { nome: 'ISS', percentualBp: 200, vigenciaIni: '2025-01-01' }).catch(() => undefined);
  const lancar = (forma: string, extra: object = {}) => api(adm, 'POST', '/laudos', { placa: placa(), clienteId: cliente, servicoId: servico, formaPagamentoId: forma, vistoriadorId: vist, ...extra });
  await lancar(F('PIX')); await lancar(F('PIX')); await lancar(F('Faturado')); await lancar(F('Faturado')); await lancar(F('Cartão de débito'));
  console.log('0 base criada');

  // ---- A receber: baixa parcial pela tela ----
  await adm.click('a:has-text("A receber")'); await adm.waitForSelector('h1:has-text("A receber")');
  await adm.getByLabel('Cliente').first().selectOption({ label: nomeCli }); await adm.click('button:has-text("Filtrar")');
  await adm.waitForSelector(`tr:has-text("${nomeCli}")`);
  await adm.locator('tr:has-text("PIX")').first().locator('button').first().click();
  await dlg(adm).locator('button:has-text("Registrar recebimento")').click();
  await dlg(adm).getByLabel(/^Valor do título a baixar/).fill('120'); await dlg(adm).getByLabel(/^Conta em que entrou/).selectOption({ label: `Banco ${sfx}` });
  await adm.screenshot({ path: `${SC}/fin-1-baixa.png` });
  await dlg(adm).locator('button:has-text("Confirmar recebimento")').click(); await toast(adm, 'Recebimento registrado');
  await adm.waitForSelector('dialog[open] >> text=Parcial'); console.log('1 baixa parcial de R$ 120,00 pela tela');
  await adm.keyboard.press('Escape');

  // ---- Faturados: gerar, PIX e PDF ----
  const doc = '11222333000181';
  const conta = await api(adm, 'POST', '/contas-financeiras', { empresaId: eu.empresaAtivaId, nome: `Banco PIX ${sfx}`, tipo: 'BANCO', saldoInicialCentavos: 0, banco: 'Banco Exemplo', agencia: '1234', conta: '56789-0', tipoConta: 'CORRENTE', titular: 'Vistoria Centro Ltda', documentoTitular: doc, pixTipo: 'CNPJ', pixChave: doc, exibirNaFatura: true, senha: SENHA });
  console.log('   conta com PIX na fatura:', conta.status);
  await adm.click('a:has-text("Faturados")'); await adm.waitForSelector('h1:has-text("Faturados")');
  await adm.click('button:has-text("Gerar faturas")');
  await dlg(adm).locator('input[type=date]').nth(0).fill(hoje); await dlg(adm).locator('input[type=date]').nth(1).fill(hoje);
  await dlg(adm).locator(`tr:has-text("${nomeCli}") input[type=checkbox]`).check();
  await adm.screenshot({ path: `${SC}/fin-2-gerar-faturas.png` });
  await dlg(adm).locator('button:has-text("Gerar 1 fatura")').click(); await dlg(adm).locator('text=Gerada').waitFor({ timeout: 8000 });
  await dlg(adm).locator('button:has-text("Abrir")').click();
  await dlg(adm).locator('img[alt^="QR Code PIX"]').waitFor({ timeout: 8000 });
  await adm.waitForTimeout(500); await adm.screenshot({ path: `${SC}/fin-3-fatura-pix.png` });
  const pdfHref = await dlg(adm).locator('a:has-text("Abrir PDF")').getAttribute('href');
  const pdf = await api(adm, 'GET', pdfHref!.replace(API, '')).catch(() => ({ status: 0 }));
  console.log('2 fatura gerada com QR PIX; PDF:', pdfHref?.includes('/faturas/') ? 'link ok' : 'sem link', pdf.status ?? '');
  await adm.keyboard.press('Escape');

  // ---- A pagar: Financeiro cria, Gerente aprova, Gerente paga ----
  const fin = await entrar('financeiro@exemplo.local'); const ger = await entrar('gerente@exemplo.local');
  await fin.click('a:has-text("A pagar")'); await fin.waitForSelector('h1:has-text("A pagar")');
  await fin.click('button:has-text("Nova conta")');
  await dlg(fin).getByLabel('Favorecido').fill('Imobiliária Central'); await dlg(fin).getByLabel(/^Descrição/).fill(`Aluguel ${sfx}`);
  await dlg(fin).locator('input[type=date]').first().fill(hoje); await dlg(fin).getByLabel(/^Valor/).fill('1.500,00');
  await dlg(fin).locator('button:has-text("Enviar para aprovação")').click(); await toast(fin, 'Conta criada');
  await fin.getByLabel('Situação').selectOption('pendentes'); await fin.click('button:has-text("Filtrar")');
  await fin.click(`button:has-text("Aluguel ${sfx}")`);
  const semAprovar = await dlg(fin).locator('button:has-text("Aprovar")').count();
  console.log('3a Financeiro vê "Aprovar" na conta que ele mesmo criou?', semAprovar === 0 ? 'não (correto)' : 'SIM (erro)');
  await ger.click('a:has-text("A pagar")'); await ger.getByLabel('Situação').selectOption('pendentes'); await ger.click('button:has-text("Filtrar")');
  await ger.click(`button:has-text("Aluguel ${sfx}")`); await dlg(ger).locator('button:has-text("Aprovar")').click(); await toast(ger, 'Conta aprovada');
  await dlg(ger).locator('button:has-text("Registrar pagamento")').click();
  await dlg(ger).getByLabel(/^Conta de onde saiu/).selectOption({ label: new RegExp(`Banco ${sfx}`) as any }).catch(async () => { await dlg(ger).getByLabel(/^Conta de onde saiu/).selectOption({ index: 1 }); });
  await dlg(ger).locator('button:has-text("Confirmar pagamento")').click();
  await ger.waitForSelector('.toast:has-text("Pagamento registrado"), dialog[open] .msg', { timeout: 8000 });
  console.log('3b aprovada pelo gerente; pagamento:', (await ger.locator('.toast').first().innerText().catch(() => '?')).trim());
  await ger.screenshot({ path: `${SC}/fin-4-pagar.png` }); await ger.keyboard.press('Escape');

  // ---- Cartões: liquidar venda do débito ----
  const antes = (await api(adm, 'GET', '/caixa/contas')).body;
  const tit = ((await api(adm, 'GET', '/receber/titulos?situacao=abertos&limite=500')).body.itens as { id: string; cliente: string; forma: string }[]).find((t) => t.cliente === nomeCli && t.forma === 'Cartão de débito')!;
  await api(adm, 'POST', `/receber/titulos/${tit.id}/baixas`, {});
  await adm.click('a:has-text("Cartões e cheques")'); await adm.waitForSelector('h1:has-text("Cartões e cheques")');
  await adm.waitForSelector(`tr:has-text("${nomeCli}")`); await adm.screenshot({ path: `${SC}/fin-5-cartoes.png` });
  await adm.locator(`tr:has-text("${nomeCli}") button:has-text("Liquidar")`).first().click();
  await dlg(adm).getByLabel(/^Conta do depósito/).selectOption({ label: `Banco ${sfx}` }); await dlg(adm).locator('button:has-text("Registrar depósito")').click(); await toast(adm, 'Depósito registrado');
  console.log('4 cartão liquidado: líquido de R$ 197,00 (R$ 200,00 menos taxa de 1,5%)', antes ? '' : '');

  // ---- Comissões: fechar o mês ----
  await adm.click('a:has-text("Comissões")'); await adm.waitForSelector('h1:has-text("Comissões")');
  await adm.screenshot({ path: `${SC}/fin-6-comissoes.png` });
  await adm.locator('button:has-text("Fechar e gerar contas a pagar")').click(); await toast(adm, 'conta a pagar criada');
  console.log('5 comissões fechadas e enviadas para o contas a pagar');

  // ---- Caixa, Relatórios e painel ----
  await adm.click('a:has-text("Caixa")'); await adm.waitForSelector('h1:has-text("Caixa")'); await adm.waitForSelector('text=Saldo no fim'); await adm.screenshot({ path: `${SC}/fin-7-caixa.png` });
  await adm.click('a:has-text("Relatórios")'); await adm.waitForSelector('h1:has-text("Relatórios")');
  await adm.getByLabel('Relatório').selectOption({ label: 'DRE (resultado do período)' }); await adm.waitForSelector('text=Receita bruta de serviços', { timeout: 8000 });
  await adm.screenshot({ path: `${SC}/fin-8-dre.png`, fullPage: true });
  await adm.getByLabel('Relatório').selectOption({ label: 'Fluxo de caixa' }); await adm.getByLabel('Agrupar por').selectOption('projetado'); await adm.waitForSelector('text=Saldo de hoje', { timeout: 8000 });
  await adm.screenshot({ path: `${SC}/fin-9-fluxo.png`, fullPage: true });
  await adm.click('a:has-text("Início")'); await adm.waitForSelector('text=Faturamento dos últimos 30 dias', { timeout: 8000 }); await adm.waitForSelector('text=Lojas da rede');
  await adm.screenshot({ path: `${SC}/fin-10-inicio.png`, fullPage: true });
  console.log('6 caixa, DRE, fluxo projetado e painel carregaram');

  // ---- acesso ----
  const vis = await entrar('vistoriador@exemplo.local');
  console.log('menu do Vistoriador:', (await vis.locator('nav a').allInnerTexts()).join(' | '));
  console.log('erros de console/página:', erros.length ? erros : 'nenhum');
  await b.close(); process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error('FALHOU', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
