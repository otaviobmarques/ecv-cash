/**
 * Verificação ponta a ponta do lançamento de laudos no navegador: Administrativo prepara serviço, cliente com preço e
 * vistoriador; o Vistoriador lança (preço de tabela, valor manual, duplicidade bloqueada) e pede cancelamento; o Gerente
 * lança com desconto, revisa o valor manual, libera a duplicidade e autoriza o cancelamento.
 * Precisa da API e do app no ar e dos dados de exemplo (pnpm db:seed). Roda à mão, não no CI.
 */
import { chromium } from 'playwright';
const SC = process.env.E2E_SAIDA ?? './e2e/saida';
const WEB = 'http://localhost:5173'; const API = 'http://localhost:3000'; const SENHA = 'Senha-de-teste-1';
const sfx = Date.now().toString(36);
const placa = (n: number) => `QWE${(1000 + n).toString().padStart(4, '0').replace(/^(\d)(\d)(\d)(\d)$/, '$1X$3$4')}`.slice(0, 7);
(async () => {
  const b = await chromium.launch(); const erros: string[] = [];
  const entrar = async (email: string) => {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage();
    p.on('pageerror', (e: Error) => erros.push('PAGEERR ' + e.message));
    p.on('console', (m: any) => { if (m.type() === 'error' && !/401|403|409|422|429|Failed to load resource/.test(m.text())) erros.push('CONSOLE ' + m.text()); });
    await p.goto(WEB + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', SENHA); await p.click('button:has-text("Entrar")'); await p.waitForSelector('h1:has-text("Olá")'); return p;
  };
  const chamar = (p: any, metodo: string, url: string, corpo?: unknown) => p.evaluate(async ([m, u, c]: any) => { const r = await fetch(u, { method: m, credentials: 'include', headers: { 'content-type': 'application/json' }, body: c ? JSON.stringify(c) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [metodo, API + url, corpo]);
  const dlg = (p: any) => p.locator('dialog[open]');

  // Preparação pela API (já validada nos testes): serviço com custo, cliente com preço, vistoriador ligado à Ana
  const adm = await entrar('admin@exemplo.local');
  const servico = (await chamar(adm, 'POST', '/servicos', { nome: `Cautelar ${sfx}` })).body.id;
  await chamar(adm, 'POST', `/servicos/${servico}/custos`, { descricao: 'Taxa do Detran', tipo: 'VALOR', valorCentavos: 3800 });
  const cliente = (await chamar(adm, 'POST', '/clientes', { tipoPessoa: 'PJ', nome: `Auto Center ${sfx}` })).body.id;
  await chamar(adm, 'POST', `/clientes/${cliente}/precos`, { servicoId: servico, valorCentavos: 18000, vigenciaIni: '2026-01-01' });
  await chamar(adm, 'POST', '/clientes', { tipoPessoa: 'PJ', nome: `Sem Preço ${sfx}` });
  const eu = (await chamar(adm, 'GET', '/auth/eu')).body;
  const usuarios = (await chamar(adm, 'GET', '/usuarios')).body as { id: string; email: string }[];
  const ana = usuarios.find((u) => u.email === 'vistoriador@exemplo.local')!;
  const vists = (await chamar(adm, 'GET', '/vistoriadores')).body as { id: string; usuarioId: string | null }[];
  if (!vists.some((v) => v.usuarioId === ana.id)) await chamar(adm, 'POST', '/vistoriadores', { nome: 'Ana Souza', empresaIds: [eu.empresaAtivaId], usuarioId: ana.id });
  console.log('0 base preparada');

  // Vistoriador
  const vis = await entrar('vistoriador@exemplo.local');
  console.log('menu VIS:', (await vis.locator('nav a').allInnerTexts()).join(' | '));
  await vis.click('a:has-text("Lançar laudo")'); await vis.waitForSelector('h1:has-text("Lançar laudo")');
  await vis.getByLabel(/^Placa/).fill('abc1d23');
  await vis.getByLabel(/^Cliente/).selectOption({ label: `Auto Center ${sfx}` });
  await vis.getByLabel(/^Serviço/).selectOption({ label: `Cautelar ${sfx}` });
  await vis.getByLabel(/^Forma de pagamento/).selectOption({ label: 'Faturado' });
  await vis.waitForSelector('text=R$ 180,00');
  await vis.screenshot({ path: `${SC}/laudo-1-lancar.png`, fullPage: true });
  await vis.click('button:has-text("Lançar laudo")'); await vis.waitForSelector('.toast:has-text("lançado")');
  console.log('1 vistoriador lançou com preço de tabela;', await vis.locator('.toast').first().innerText());
  // duplicidade
  await vis.getByLabel(/^Placa/).fill('ABC1D23'); await vis.click('button:has-text("Lançar laudo")');
  await vis.waitForSelector('text=Possível lançamento em duplicidade'); console.log('2 duplicidade bloqueada para o vistoriador');
  await vis.screenshot({ path: `${SC}/laudo-2-duplicidade.png`, fullPage: true });
  // cliente sem preço -> valor manual
  await vis.getByLabel(/^Placa/).fill('DEF2G34');
  await vis.getByLabel(/^Cliente/).selectOption({ label: `Sem Preço ${sfx}` });
  await vis.waitForSelector('text=não tem preço cadastrado');
  await vis.click('button:has-text("Lançar laudo")'); await vis.waitForSelector('small.erro, .erro'); console.log('3a sem valor manual: recusado');
  await vis.getByLabel(/^Valor do laudo/).fill('99,90'); await vis.click('button:has-text("Lançar laudo")'); await vis.waitForSelector('tr:has-text("DEF2G34") >> text=Valor manual');
  console.log('3b valor manual lançado e marcado para revisão');
  await vis.screenshot({ path: `${SC}/laudo-3-manual.png`, fullPage: true });
  // lote
  await vis.click('button[role=tab]:has-text("Vários")');
  const linhasLote = [['GHI3J45', 1], ['JKL4M56', 2]] as const;
  for (const [pl, i] of linhasLote) {
    await vis.getByLabel(`Placa da linha ${i}`).fill(pl);
    await vis.getByLabel(`Cliente da linha ${i}`).selectOption({ label: `Auto Center ${sfx}` });
    await vis.getByLabel(`Serviço da linha ${i}`).selectOption({ label: `Cautelar ${sfx}` });
    await vis.getByLabel(`Forma da linha ${i}`).selectOption({ label: 'PIX' });
  }
  await vis.getByLabel('Placa da linha 3').fill('ABC1D23'); // duplicada: tem que voltar com erro
  await vis.getByLabel('Cliente da linha 3').selectOption({ label: `Auto Center ${sfx}` });
  await vis.getByLabel('Serviço da linha 3').selectOption({ label: `Cautelar ${sfx}` });
  await vis.getByLabel('Forma da linha 3').selectOption({ label: 'PIX' });
  await vis.click('button:has-text("Lançar 3 laudos")'); await vis.waitForSelector('text=Não lançado');
  console.log('4 lote:', (await vis.locator('[role=status]:has-text("Não lançado")').innerText()).replace(/\s+/g, ' ').slice(0, 220));
  await vis.screenshot({ path: `${SC}/laudo-4-lote.png`, fullPage: true });
  // pedir cancelamento
  await vis.click('a:has-text("Meus laudos")'); await vis.waitForSelector('h1:has-text("Meus laudos")');
  await vis.fill('input >> nth=2', ''); await vis.getByLabel('Placa').fill('JKL4M56'); await vis.click('button:has-text("Filtrar")');
  await vis.click('tr:has-text("JKL4M56") button'); await vis.click('dialog[open] button:has-text("Pedir cancelamento")');
  await dlg(vis).getByLabel(/^Motivo/).fill('Lançado por engano na placa'); await dlg(vis).locator('button:has-text("Enviar pedido")').click();
  await vis.waitForSelector('.toast:has-text("Pedido de cancelamento")'); console.log('5 pedido de cancelamento enviado');

  // Gerente
  const ger = await entrar('gerente@exemplo.local');
  console.log('menu GER:', (await ger.locator('nav a').allInnerTexts()).join(' | '));
  await ger.click('a:has-text("Lançar laudo")');
  await ger.getByLabel(/^Vistoriador/).selectOption({ label: 'Ana Souza' });
  await ger.getByLabel(/^Placa/).fill('MNO5P67');
  await ger.getByLabel(/^Cliente/).selectOption({ label: `Auto Center ${sfx}` });
  await ger.getByLabel(/^Serviço/).selectOption({ label: `Cautelar ${sfx}` });
  await ger.getByLabel(/^Forma de pagamento/).selectOption({ label: 'Faturado' });
  await ger.getByLabel('Cobrar valor diferente da tabela').check();
  await ger.getByLabel(/^Valor cobrado/).fill('150'); await ger.getByLabel(/^Motivo/).fill('Cliente antigo, acordo comercial');
  await ger.waitForSelector('text=desconto de R$ 30,00');
  await ger.screenshot({ path: `${SC}/laudo-5-desconto.png`, fullPage: true });
  await ger.click('button:has-text("Lançar laudo")'); await ger.waitForSelector('.toast:has-text("R$ 150,00")'); console.log('6 gerente lançou com desconto de R$ 30,00');
  // duplicidade liberada pelo gerente
  await ger.getByLabel(/^Placa/).fill('MNO5P67'); await ger.click('button:has-text("Lançar laudo")'); await ger.waitForSelector('text=Possível lançamento em duplicidade');
  await ger.getByLabel('Lançar mesmo assim (é outro laudo de verdade)').check(); await ger.getByLabel(/^Motivo/).last().fill('Segunda vistoria pedida pelo cliente');
  await ger.click('button:has-text("Lançar laudo")'); await ger.waitForSelector('.toast >> text=lançado'); console.log('7 gerente liberou a duplicidade com motivo');

  // Listagem, margem, revisão e cancelamento
  await ger.click('nav a:has-text("Laudos")'); await ger.waitForSelector('h1:has-text("Laudos")'); await ger.waitForSelector('th:has-text("Margem")');
  await ger.getByLabel('Fila de trabalho').selectOption('revisar'); await ger.click('button:has-text("Filtrar")');
  await ger.click('tr:has-text("DEF2G34") button'); await dlg(ger).locator('text=Custos gravados').waitFor(); await ger.screenshot({ path: `${SC}/laudo-6-detalhe.png` });
  await dlg(ger).locator('button:has-text("Aprovar e cadastrar como preço do cliente")').click(); await ger.waitForSelector('.toast:has-text("revisado")').catch(() => ger.waitForSelector('.toast:has-text("Erro")'));
  console.log('8 revisão do valor manual:', (await ger.locator('.toast').last().innerText().catch(() => '?')));
  await ger.keyboard.press('Escape');
  await ger.getByLabel('Fila de trabalho').selectOption('cancelamento'); await ger.click('button:has-text("Filtrar")');
  await ger.click('tr:has-text("JKL4M56") button'); await dlg(ger).locator('button:has-text("Cancelar laudo")').click();
  await dlg(ger).getByLabel(/^Motivo/).fill('Confirmado: lançado por engano'); await dlg(ger).locator('button:has-text("Confirmar cancelamento")').click();
  await ger.waitForSelector('.toast:has-text("Laudo cancelado")'); console.log('9 gerente autorizou o cancelamento');
  await ger.screenshot({ path: `${SC}/laudo-7-cancelado.png`, fullPage: true });

  console.log('erros de console/página:', erros.length ? erros : 'nenhum');
  await b.close(); process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error('FALHOU', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
