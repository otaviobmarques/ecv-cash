/**
 * Verificação ponta a ponta das telas de Cadastros no navegador: serviço e custo, cliente com primeiro preço e reajuste,
 * fornecedor, taxas do cartão, vistoriador, conta bancária com confirmação por senha, plano de contas e o fluxo do
 * Gerente (reajuste bloqueado, pedido de alteração da conta) com a aprovação do Administrativo.
 * Precisa da API e do app no ar e dos dados de exemplo (pnpm db:seed). Roda à mão, não no CI.
 */
import { chromium } from 'playwright';
const SC = process.env.E2E_SAIDA ?? './e2e/saida';
const WEB = 'http://localhost:5173'; const SENHA = 'Senha-de-teste-1';
const sfx = Date.now().toString(36);
const cnpj = () => { const b = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)); const dv = (d: number[], p: number[]) => { const r = d.reduce((a, n, i) => a + n * p[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); const d2 = dv([...b, d1], [6,5,4,3,2,9,8,7,6,5,4,3,2]); return [...b, d1, d2].join(''); };
const PAGES: any[] = [];
(async () => {
  const b = await chromium.launch(); const erros: string[] = [];
  const entrar = async (email: string) => { const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage(); PAGES.push(p); p.on('pageerror', (e: Error) => erros.push('PAGEERR ' + e.message)); p.on('console', (m: any) => { if (m.type() === 'error' && !/401|403|409|422|429|Failed to load resource/.test(m.text())) erros.push('CONSOLE ' + m.text()); });
    await p.goto(WEB + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', SENHA); await p.click('button:has-text("Entrar")'); await p.waitForSelector('h1:has-text("Olá")'); return p; };
  const dlg = (p: any) => p.locator('dialog[open]');

  const adm = await entrar('admin@exemplo.local');
  console.log('menu ADM:', (await adm.locator('nav a').allInnerTexts()).join(' | '));

  // Serviços e custos
  await adm.click('a:has-text("Cadastros")'); await adm.waitForSelector('button[role=tab]:has-text("Serviços")');
  await adm.click('button:has-text("Novo serviço")'); let d = dlg(adm);
  await d.getByLabel(/^Nome do serviço/).fill(`Vistoria cautelar ${sfx}`); await d.getByLabel('Código').fill('CAU');
  await d.getByLabel('Conta de receita').selectOption({ label: '1.1 Vistoria cautelar' });
  await d.locator('button:has-text("Cadastrar serviço")').click(); await adm.waitForSelector(`td:has-text("Vistoria cautelar ${sfx}")`);
  await adm.locator(`tr:has-text("Vistoria cautelar ${sfx}")`).locator('button:has-text("Novo custo")').click(); d = dlg(adm);
  await d.getByLabel(/^Descrição/).fill('Taxa do Detran'); await d.getByLabel(/^Valor por laudo/).fill('38'); await d.getByLabel(/^Gera conta a pagar|Gera conta a pagar/).check().catch(() => undefined);
  await d.locator('button:has-text("Salvar custo")').click(); await adm.waitForSelector('text=Taxa do Detran: R$ 38,00');
  console.log('1 serviço e custo criados');
  await adm.screenshot({ path: `${SC}/cad-1-servicos.png` });

  // Cliente e preço
  await adm.click('a:has-text("Clientes e preços")'); await adm.click('button:has-text("Novo cliente")'); d = dlg(adm);
  await d.getByLabel(/^Nome ou razão social/).fill(`Auto Center ${sfx}`); await d.getByLabel('CNPJ').fill('123'); await d.locator('button:has-text("Cadastrar cliente")').click();
  await adm.waitForSelector('dialog[open] small.erro'); console.log('2a CNPJ inválido recusado:', await d.locator('small.erro').first().innerText());
  await d.getByLabel('CNPJ').fill(cnpj()); await d.locator('button:has-text("Cadastrar cliente")').click();
  await adm.waitForSelector(`h2:has-text("Auto Center ${sfx}")`);
  await adm.locator(`tr:has-text("Vistoria cautelar ${sfx}")`).locator('button:has-text("Cadastrar primeiro preço")').click(); d = dlg(adm);
  await d.getByLabel(/^Valor/).fill('180'); await d.locator('button:has-text("Cadastrar preço")').click();
  await adm.waitForSelector(`tr:has-text("Vistoria cautelar ${sfx}") td:has-text("R$ 180,00")`);
  console.log('2b primeiro preço R$ 180,00 cadastrado');
  await adm.locator(`tr:has-text("Vistoria cautelar ${sfx}")`).locator('button:has-text("Reajustar")').click(); d = dlg(adm);
  const amanha = new Date(Date.now() + 30 * 86400000).toLocaleDateString('sv-SE'); await d.getByLabel(/^Valor/).fill('195,50'); await d.getByLabel('Começa a valer em').fill(amanha);
  await d.locator('button:has-text("Confirmar reajuste")').click(); await d.locator('small.erro:has-text("motivo")').first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await d.getByLabel(/^Motivo do reajuste/).fill('Reajuste anual de tabela'); await d.locator('button:has-text("Confirmar reajuste")').click();
  await adm.waitForSelector(`tr:has-text("Vistoria cautelar ${sfx}") td:has-text("R$ 195,50")`);
  console.log('2c reajuste agendado; linha:', (await adm.locator(`tr:has-text("Vistoria cautelar ${sfx}")`).first().innerText()).replace(/\s+/g, ' ').slice(0, 140));
  await adm.screenshot({ path: `${SC}/cad-2-cliente.png`, fullPage: true });

  // Fornecedor
  await adm.click('a:has-text("Fornecedores")'); await adm.click('button:has-text("Novo fornecedor")'); d = dlg(adm);
  await d.getByLabel(/^Nome ou razão social/).fill(`Detran ${sfx}`); await d.getByLabel('Tipo').selectOption('ORGAO_PUBLICO'); await d.locator('button:has-text("Cadastrar fornecedor")').click();
  await adm.waitForSelector(`td:has-text("Detran ${sfx}")`); console.log('3 fornecedor criado');

  // Formas: taxas por loja
  await adm.click('a:has-text("Cadastros")'); await adm.click('button[role=tab]:has-text("Formas de pagamento")');
  await adm.locator('tr:has-text("Cartão de crédito")').locator('button:has-text("Taxas por loja")').click(); d = dlg(adm);
  const caixa = d.locator('div.cartao').first();
  await caixa.getByLabel('Taxa (%)').fill('2,69'); await caixa.getByLabel('Recebe em (dias)').fill('30'); await caixa.locator('button:has-text("Salvar")').click();
  await adm.waitForSelector('text=Taxas de Loja Centro salvas'); await adm.keyboard.press('Escape');
  await adm.waitForSelector('tr:has-text("Cartão de crédito") >> text=2,69%'); console.log('4 taxas do cartão salvas');

  // Vistoriador
  await adm.click('button[role=tab]:has-text("Vistoriadores")'); await adm.click('button:has-text("Novo vistoriador")'); d = dlg(adm);
  await d.getByLabel(/^Nome/).first().fill(`Ana Souza ${sfx}`); await d.getByLabel('Loja Centro').check(); await d.locator('button:has-text("Cadastrar vistoriador")').click();
  await adm.waitForSelector(`td:has-text("Ana Souza ${sfx}")`); console.log('5 vistoriador criado');

  // Contas
  await adm.click('button[role=tab]:has-text("Contas bancárias")'); await adm.click('button:has-text("Nova conta")'); d = dlg(adm);
  await d.getByLabel(/^Loja/).selectOption({ label: 'Loja Centro' }); await d.getByLabel(/^Nome da conta/).fill('Itaú principal');
  await d.getByLabel('Banco', { exact: true }).selectOption('Itaú (341)'); await d.getByLabel('Agência').fill('1234'); await d.getByLabel('Conta com dígito').fill('12345-6');
  await d.getByLabel('Titular', { exact: true }).fill('Centro Vistorias Ltda'); await d.getByLabel('CPF ou CNPJ do titular').fill('11222333000181');
  await d.getByLabel('Tipo da chave PIX').selectOption('CNPJ'); await d.getByLabel('Chave PIX', { exact: true }).fill('11.222.333/0001-81'); await d.getByLabel(/Mostrar esta conta na fatura/).check();
  await d.locator('button:has-text("Cadastrar conta")').click(); await d.locator('small.erro:has-text("senha")').first().waitFor({ timeout: 4000 }).catch(() => undefined);
  console.log('6a sem senha, recusado:', (await d.locator('.msg.erro, small.erro').first().innerText().catch(() => '(sem msg)')).slice(0, 80));
  await d.getByLabel('Sua senha').fill(SENHA); await d.locator('button:has-text("Cadastrar conta")').click();
  await adm.waitForSelector('tr:has-text("Itaú principal") >> text=Aparece na fatura'); console.log('6b conta criada com confirmação por senha; aparece na fatura');
  await adm.screenshot({ path: `${SC}/cad-3-contas.png`, fullPage: true });

  // Plano de contas
  await adm.click('button[role=tab]:has-text("Plano de contas")'); await adm.waitForSelector('td:has-text("Receitas")');
  console.log('7 plano de contas:', await adm.locator('tbody tr').count(), 'contas');
  await adm.screenshot({ path: `${SC}/cad-4-plano.png` });

  // Gerente
  const ger = await entrar('gerente@exemplo.local');
  console.log('menu Gerente:', (await ger.locator('nav a').allInnerTexts()).join(' | '));
  await ger.click('a:has-text("Clientes e preços")'); await ger.locator(`button:has-text("Auto Center ${sfx}")`).click(); await ger.waitForSelector(`h2:has-text("Auto Center ${sfx}")`);
  console.log('8a Gerente vê reajuste bloqueado:', await ger.locator('text=reajuste só pelo Administrativo').count(), '| botão Reajustar:', await ger.locator('button:has-text("Reajustar")').count());
  await ger.screenshot({ path: `${SC}/cad-5-gerente-cliente.png` });
  await ger.click('a:has-text("Cadastros")'); await ger.click('button[role=tab]:has-text("Contas bancárias")'); await ger.waitForSelector('tr:has-text("Itaú principal")');
  await ger.locator('tr:has-text("Itaú principal")').locator('button:has-text("Editar")').click(); d = dlg(ger);
  await d.getByLabel('Chave PIX', { exact: true }).fill('financeiro@centro.local'); await d.getByLabel('Tipo da chave PIX').selectOption('EMAIL');
  console.log('8b aviso de pedido ao Gerente:', (await d.locator('.msg.aviso').first().innerText()).replace(/\s+/g, ' ').slice(0, 90));
  await d.locator('button:has-text("Enviar pedido")').click();
  await ger.waitForSelector('text=Aguardando o Administrativo').catch(() => undefined);
  await ger.waitForSelector('h2:has-text("Pedidos de alteração aguardando o Administrativo")');
  await ger.screenshot({ path: `${SC}/cad-6-gerente-pedido.png`, fullPage: true });
  console.log('8c pedido pendente criado; conta mantém PIX antigo:', await ger.locator('tr:has-text("Itaú principal")').innerText().then((t: string) => t.includes('11.222.333/0001-81')));

  // ADM aprova
  await adm.reload(); await adm.click('a:has-text("Cadastros")'); await adm.click('button[role=tab]:has-text("Contas bancárias")');
  await adm.waitForSelector('h2:has-text("aguardando a sua decisão")'); await adm.click('button:has-text("Revisar e aprovar")'); d = dlg(adm);
  await d.getByLabel('Sua senha').fill('errada-errada-1'); await d.locator('button:has-text("Aprovar e aplicar")').click(); await d.locator('.msg.erro').first().waitFor();
  console.log('9a senha errada:', (await d.locator('.msg.erro').innerText()).trim());
  await d.getByLabel('Sua senha').fill(SENHA); await d.locator('button:has-text("Aprovar e aplicar")').click();
  await adm.waitForSelector('tr:has-text("Itaú principal") >> text=financeiro@centro.local'); console.log('9b aprovado: PIX novo aplicado');

  console.log(erros.length ? 'ERROS DE CONSOLE:\n' + erros.join('\n') : 'sem erros de console');
  await b.close();
})().catch(async (e: Error) => { console.error('FALHOU:', e.message.split('\n').slice(0, 7).join('\n')); for (const [i, p] of PAGES.entries()) { await p.screenshot({ path: `${SC}/falha-cad-${i}.png` }).catch(() => undefined); console.error('pagina', i, p.url()); } process.exit(1); });
