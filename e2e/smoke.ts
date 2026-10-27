/**
 * Verificação ponta a ponta no navegador: backoffice cria um grupo, o cliente aceita o convite e usa as telas,
 * o Gerente vê só a loja dele e o suporte entra como o cliente. Roda contra API + dois fronts já no ar
 * (ver README). Precisa de Playwright (pnpm dlx playwright install chromium) e de um usuário interno novo:
 *   pnpm --filter @ecv/api bo:criar-interno "Teste" otavio.teste@interno.local PLATAFORMA
 * Não roda no CI porque depende de navegador e dos três serviços. Zere o 2FA do usuário entre execuções.
 */
import { chromium } from 'playwright';
import { codigoTotp, passoAtual } from '../apps/api/src/backoffice/totp';

const SC = process.env.E2E_SAIDA ?? './e2e/saida';
const BO = 'http://localhost:5174', WEB = 'http://localhost:5173';
const SENHA_BO = process.argv[2]!;
if (!SENHA_BO) throw new Error('Uso: pnpm e2e <senha provisória do usuário interno otavio.teste@interno.local>');
const sufixo = Date.now().toString(36);
const cnpj = (() => { const b = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)); const dv = (d: number[], p: number[]) => { const r = d.reduce((a, n, i) => a + n * p[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); const d2 = dv([...b, d1], [6,5,4,3,2,9,8,7,6,5,4,3,2]); return [...b, d1, d2].join(''); })();

const PAGES: any[] = [];
(async () => {
  const b = await chromium.launch();
  const erros: string[] = [];
  const nova = async (url: string) => { const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } }); const p = await ctx.newPage(); PAGES.push(p); p.on('pageerror', (e) => erros.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) erros.push('CONSOLE ' + m.text()); }); await p.goto(url); return p; };

  // 1) Backoffice: login + configurar 2FA
  const bo = await nova(BO);
  await bo.fill('input[type=email]', 'otavio.teste@interno.local'); await bo.fill('input[type=password]', SENHA_BO);
  await bo.click('button:has-text("Continuar")');
  await bo.waitForSelector('text=Configure o autenticador');
  const segredo = (await bo.locator('code').innerText()).trim();
  await bo.screenshot({ path: `${SC}/bo-1-mfa.png` });
  await bo.fill('input[autocomplete=one-time-code]', codigoTotp(segredo, passoAtual()));
  await bo.click('button:has-text("Confirmar")');
  await bo.waitForSelector('h1:has-text("Grupos")');
  console.log('1 backoffice: login com 2FA ok');

  // 2) Criar grupo
  await bo.click('button:has-text("Novo grupo")');
  await bo.fill('input >> nth=2', `Rede Teste ${sufixo}`).catch(() => undefined);
  const dlg = bo.locator('dialog[open]');
  await dlg.getByLabel('Nome do grupo').fill(`Rede Teste ${sufixo}`);
  await dlg.getByLabel('CNPJ').fill(cnpj);
  await dlg.getByLabel('Razão social').fill('Loja Centro Vistorias Ltda');
  await dlg.getByLabel('Nome fantasia').fill('Loja Centro');
  await dlg.getByLabel('Cidade').fill('Santos'); await dlg.getByLabel('UF').fill('SP');
  await dlg.getByLabel(/^Nome \*$/).fill('Marina Alves');
  await dlg.getByLabel(/^E-mail/).fill(`marina.${sufixo}@cliente.local`);
  await bo.screenshot({ path: `${SC}/bo-2-novo-grupo.png` });
  await dlg.locator('button:has-text("Criar grupo")').click();
  await bo.waitForSelector('text=Grupo criado');
  const convite = await bo.locator('dialog[open] input[readonly]').inputValue();
  console.log('2 grupo criado; convite:', convite.replace(/token=.*/, 'token=***'));
  await bo.keyboard.press('Escape');
  await bo.screenshot({ path: `${SC}/bo-3-lista.png` });

  // 3) Cliente aceita o convite e entra
  const w = await nova(convite);
  await w.fill('input[autocomplete=new-password] >> nth=0', 'Senha-da-marina-1'); await w.fill('input[autocomplete=new-password] >> nth=1', 'Senha-da-marina-1');
  await w.click('button:has-text("Definir senha")');
  await w.waitForURL('**/login');
  await w.fill('input[type=email]', `marina.${sufixo}@cliente.local`); await w.fill('input[type=password]', 'Senha-da-marina-1');
  await w.click('button:has-text("Entrar")');
  await w.waitForSelector('h1:has-text("Olá, Marina")');
  await w.screenshot({ path: `${SC}/web-1-inicio.png` });
  console.log('3 cliente: convite aceito e login ok');

  // 4) Empresas: nova empresa
  await w.click('a:has-text("Empresas")'); await w.click('button:has-text("Nova empresa")');
  const d2 = w.locator('dialog[open]');
  const cnpj2 = (() => { const b2 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)); const dv = (d: number[], p: number[]) => { const r = d.reduce((a, n, i) => a + n * p[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; }; const x1 = dv(b2, [5,4,3,2,9,8,7,6,5,4,3,2]); const x2 = dv([...b2, x1], [6,5,4,3,2,9,8,7,6,5,4,3,2]); return [...b2, x1, x2].join(''); })();
  await d2.getByLabel('CNPJ').fill('12345678000100'); await d2.getByLabel('Razão social').fill('Norte Vistorias Ltda'); await d2.getByLabel('Nome fantasia').fill('Loja Norte'); await d2.getByLabel('Cidade').fill('Campinas'); await d2.getByLabel('UF').fill('SP');
  await d2.locator('button:has-text("Cadastrar empresa")').click();
  await w.waitForSelector('dialog[open] small.erro'); // CNPJ inválido
  console.log('4a CNPJ inválido recusado:', await d2.locator('small.erro').first().innerText());
  await d2.getByLabel('CNPJ').fill(cnpj2);
  await d2.locator('button:has-text("Cadastrar empresa")').click();
  await w.waitForSelector('td:has-text("Loja Norte")');
  await w.screenshot({ path: `${SC}/web-2-empresas.png` });
  console.log('4b empresa criada');

  // 5) Usuários: criar gerente da Loja Norte
  await w.click('a:has-text("Usuários")'); await w.click('button:has-text("Novo usuário")');
  const d3 = w.locator('dialog[open]');
  await d3.getByLabel(/^Nome \*$/).fill('Rafael Costa'); await d3.getByLabel(/^E-mail/).fill(`rafael.${sufixo}@cliente.local`);
  await d3.getByLabel('Perfil').selectOption('GERENTE'); await d3.getByLabel('Loja Norte').check();
  await w.screenshot({ path: `${SC}/web-3-novo-usuario.png` });
  await d3.locator('button:has-text("Criar e gerar convite")').click();
  await w.waitForSelector('text=Convite criado');
  const conviteRafael = await w.locator('dialog[open] input[readonly]').inputValue();
  await w.keyboard.press('Escape');
  console.log('5 usuário criado; convite gerado');

  // 6) Aparência
  await w.click('a:has-text("Aparência")');
  await w.locator('#cor-sel').evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(el, '#0b5ed7'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await w.waitForSelector('text=Boa leitura');
  await w.click('button:has-text("Salvar cor")');
  await w.waitForSelector('text=Cor salva');
  await w.waitForTimeout(600);
  await w.screenshot({ path: `${SC}/web-4-aparencia.png` });
  const brand = await w.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  console.log('6 tema aplicado ao vivo: --brand =', brand);
  await w.fill('input[maxlength="7"]', '#FFE066'); await w.waitForSelector('text=Clara demais');
  console.log('6b cor clara demais bloqueada:', await w.locator('button:has-text("Salvar cor")').isDisabled());

  // 7) Auditoria
  await w.click('a:has-text("Auditoria")'); await w.waitForSelector('td:has-text("Empresa criada")');
  await w.screenshot({ path: `${SC}/web-5-auditoria.png` });
  console.log('7 auditoria lista:', await w.locator('tbody tr').count(), 'linhas');

  // 8) Gerente entra: vê só a loja dele e menu reduzido
  const g = await nova(conviteRafael);
  await g.fill('input[autocomplete=new-password] >> nth=0', 'Senha-do-rafael-1'); await g.fill('input[autocomplete=new-password] >> nth=1', 'Senha-do-rafael-1');
  await g.click('button:has-text("Definir senha")'); await g.waitForURL('**/login');
  await g.fill('input[type=email]', `rafael.${sufixo}@cliente.local`); await g.fill('input[type=password]', 'Senha-do-rafael-1'); await g.click('button:has-text("Entrar")');
  await g.waitForSelector('h1:has-text("Olá, Rafael")');
  const menu = await g.locator('nav a').allInnerTexts();
  await g.click('a:has-text("Empresas")'); await g.waitForSelector('td:has-text("Loja Norte")');
  const linhas = await g.locator('tbody tr').count();
  const novaVisivel = await g.locator('button:has-text("Nova empresa")').count();
  console.log('8 gerente: menu =', menu.join(' | '), '| empresas visíveis =', linhas, '| botão Nova empresa =', novaVisivel);
  await g.screenshot({ path: `${SC}/web-6-gerente.png` });

  // 9) Entrar como cliente (suporte)
  await bo.goto(BO); await bo.click('a:has-text("Abrir")');
  await bo.waitForSelector('h1:has-text("Rede Teste")');
  await bo.click('button:has-text("Entrar como o cliente")');
  await bo.locator('dialog[open] textarea').fill('Conferir cadastro de preços (chamado 1234)');
  await bo.locator('dialog[open] button:has-text("Confirmar")').click();
  await bo.waitForSelector('text=Acesso de suporte pronto');
  const href = await bo.locator('dialog[open] a:has-text("Abrir o sistema do cliente")').getAttribute('href');
  const s = await nova(href!);
  await s.waitForSelector('.faixa-suporte');
  console.log('9 suporte: faixa =', (await s.locator('.faixa-suporte').innerText()).replace(/\s+/g, ' ').slice(0, 120));
  await s.screenshot({ path: `${SC}/web-7-suporte.png` });
  await bo.keyboard.press('Escape'); await bo.reload(); await bo.waitForSelector('h1:has-text("Rede Teste")');
  await bo.screenshot({ path: `${SC}/bo-4-grupo.png`, fullPage: true });

  console.log(erros.length ? 'ERROS DE CONSOLE:\n' + erros.join('\n') : 'sem erros de console');
  await b.close();
})().catch(async (e) => { console.error('FALHOU:', e.message.split('\n').slice(0, 6).join('\n')); for (const [i, p] of PAGES.entries()) { await p.screenshot({ path: SC + '/falha-' + i + '.png' }).catch(() => undefined); console.error('pagina', i, p.url()); } process.exit(1); });
