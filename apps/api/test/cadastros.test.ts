import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { DbService } from '../src/db/db.service';
import { SENHA, cliente, criarCenario, gerarCnpj, subirApp, unico } from './helpers';

const cpf = () => { // CPF válido aleatório
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (d: number[]) => { const s = d.reduce((a, x, i) => a + x * (d.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]); return [...n, d1, d2].join('');
};
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const em = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

describe('cadastros', () => {
  let app: INestApplication; let db: DbService; let cen: Awaited<ReturnType<typeof criarCenario>>;
  const [A1, A2] = [0, 1];
  const entrar = async (nome: string) => { const c = cliente(app); const r = await c.login(cen.mail(nome)); expect(r.status, nome).toBe(200); return c; };
  let adm: ReturnType<typeof cliente>, ger: ReturnType<typeof cliente>, fin: ReturnType<typeof cliente>, vis: ReturnType<typeof cliente>, gerA2: ReturnType<typeof cliente>, admB: ReturnType<typeof cliente>;

  beforeAll(async () => {
    ({ app, db } = await subirApp());
    cen = await criarCenario(db);
    [adm, ger, fin, vis, gerA2, admB] = await Promise.all([entrar('adminA'), entrar('gerenteA1'), entrar('finA1'), entrar('visA1'), entrar('gerenteA2'), entrar('adminB')]);
  });
  afterAll(() => app.close());

  describe('padrões do grupo', () => {
    it('todo grupo nasce com plano de contas e formas de pagamento', async () => {
      const plano = (await adm.get('/plano-contas')).body as { codigo: string }[];
      expect(plano.length).toBeGreaterThan(25);
      expect(plano.map((c) => c.codigo).slice(0, 3)).toEqual(['1', '1.1', '1.2']); // ordem numérica, não alfabética
      const formas = (await adm.get('/formas-pagamento')).body as { nome: string; geraFatura: boolean }[];
      expect(formas.map((f) => f.nome)).toEqual(expect.arrayContaining(['Dinheiro', 'PIX', 'Faturado']));
      expect(formas.find((f) => f.nome === 'Faturado')!.geraFatura).toBe(true);
    });
    it('carregar padrões num grupo que já os tem é recusado', async () => {
      expect((await adm.post('/cadastros/padroes')).status).toBe(400);
      expect((await ger.post('/cadastros/padroes')).status).toBe(403);
    });
  });

  describe('plano de contas', () => {
    it('Administrativo cria subconta; precisa existir a conta pai e ser do mesmo tipo', async () => {
      const ok = await adm.post('/plano-contas', { codigo: '4.7', nome: 'Seguros', tipo: 'DESPESA' });
      expect(ok.status).toBe(201);
      expect((await adm.post('/plano-contas', { codigo: '9.1', nome: 'Sem pai', tipo: 'DESPESA' })).status).toBe(422);
      expect((await adm.post('/plano-contas', { codigo: '4.8', nome: 'Tipo errado', tipo: 'RECEITA' })).status).toBe(422);
      expect((await adm.post('/plano-contas', { codigo: '4.7', nome: 'Repetida', tipo: 'DESPESA' })).status).toBe(409);
      expect((await adm.post('/plano-contas', { codigo: 'abc', nome: 'Código ruim', tipo: 'DESPESA' })).status).toBe(422);
    });
    it('só o Administrativo altera; os outros leem (menos o Vistoriador)', async () => {
      expect((await ger.post('/plano-contas', { codigo: '4.9', nome: 'Teste', tipo: 'DESPESA' })).status).toBe(403);
      expect((await ger.get('/plano-contas')).status).toBe(200);
      expect((await fin.get('/plano-contas')).status).toBe(200);
      expect((await vis.get('/plano-contas')).status).toBe(403);
    });
    it('não inativa conta com subcontas ativas nem conta em uso por serviço', async () => {
      const plano = (await adm.get('/plano-contas')).body as { id: string; codigo: string }[];
      const receitas = plano.find((c) => c.codigo === '1')!;
      expect((await adm.patch(`/plano-contas/${receitas.id}`, { status: 'INATIVO' })).status).toBe(409);
      const cautelar = plano.find((c) => c.codigo === '1.1')!;
      await adm.post('/servicos', { nome: `Cautelar ${unico()}`, contaReceitaId: cautelar.id });
      const r = await adm.patch(`/plano-contas/${cautelar.id}`, { status: 'INATIVO' });
      expect(r.status).toBe(409);
      expect(r.body.mensagem).toMatch(/em uso/i);
    });
  });

  describe('serviços e custos', () => {
    let servicoId: string;
    it('Administrativo cria serviço; nome repetido dá 409; Gerente não cria', async () => {
      const nome = `Transferência ${unico()}`;
      const r = await adm.post('/servicos', { nome, codigo: 'TRF' });
      expect(r.status).toBe(201); servicoId = r.body.id;
      expect((await adm.post('/servicos', { nome: nome.toUpperCase() })).status).toBe(409);
      expect((await ger.post('/servicos', { nome: 'Outro' })).status).toBe(403);
    });
    it('custos por valor e por percentual, com validação; só o Administrativo cria', async () => {
      expect((await adm.post(`/servicos/${servicoId}/custos`, { descricao: 'Taxa Detran', tipo: 'VALOR', valorCentavos: 3800, geraContaPagar: true })).status).toBe(201);
      expect((await adm.post(`/servicos/${servicoId}/custos`, { descricao: 'Repasse', tipo: 'PERCENTUAL', percentualBp: 500 })).status).toBe(201);
      expect((await adm.post(`/servicos/${servicoId}/custos`, { descricao: 'Sem valor', tipo: 'VALOR' })).status).toBe(422);
      expect((await ger.post(`/servicos/${servicoId}/custos`, { descricao: 'Taxa', tipo: 'VALOR', valorCentavos: 100 })).status).toBe(403);
    });
    it('cada perfil vê o que a matriz permite', async () => {
      const completo = (await adm.get('/servicos')).body as { id: string; custos?: unknown[] }[];
      expect(completo.find((s) => s.id === servicoId)!.custos).toHaveLength(2);
      expect(((await ger.get('/servicos')).body as { custos?: unknown[] }[])[0]!.custos).toBeDefined(); // Gerente vê custos
      const v = (await vis.get('/servicos')).body as Record<string, unknown>[];
      expect(Object.keys(v[0]!).sort()).toEqual(['codigo', 'id', 'nome']); // Vistoriador: só o nome
      const f = (await fin.get('/servicos')).body as Record<string, unknown>[];
      expect(JSON.stringify(f)).not.toMatch(/custos|valorCentavos/);
    });
  });

  describe('fornecedores', () => {
    it('Financeiro cadastra; CPF/CNPJ inválido ou repetido é recusado; Vistoriador não acessa', async () => {
      const doc = gerarCnpj();
      const r = await fin.post('/fornecedores', { nome: 'Imobiliária Prado', documento: doc, tipo: 'PRESTADOR' });
      expect(r.status).toBe(201);
      expect((await fin.post('/fornecedores', { nome: 'Outra', documento: doc })).status).toBe(409);
      expect((await fin.post('/fornecedores', { nome: 'Ruim', documento: '12345678000100' })).status).toBe(422);
      expect((await fin.post('/fornecedores', { nome: 'Sem documento (Detran)', tipo: 'ORGAO_PUBLICO' })).status).toBe(201);
      expect((await vis.get('/fornecedores')).status).toBe(403);
      expect((await vis.post('/fornecedores', { nome: 'Nada' })).status).toBe(403);
    });
    it('fornecedores de um grupo não aparecem no outro', async () => {
      const nome = `Exclusivo ${unico()}`;
      await adm.post('/fornecedores', { nome });
      expect(((await admB.get('/fornecedores')).body as { nome: string }[]).map((x) => x.nome)).not.toContain(nome);
    });
  });

  describe('clientes', () => {
    it('Gerente cadastra; documento é validado pelo tipo e é único no grupo', async () => {
      const doc = cpf();
      const r = await ger.post('/clientes', { tipoPessoa: 'PF', documento: doc, nome: 'João da Silva', emailsCobranca: ['joao@teste.local'] });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ periodicidade: 'MENSAL', prazoDias: 10, multaBp: 200, jurosMesBp: 100 });
      expect((await ger.post('/clientes', { tipoPessoa: 'PF', documento: doc, nome: 'Repetido' })).status).toBe(409);
      expect((await ger.post('/clientes', { tipoPessoa: 'PJ', documento: doc, nome: 'Tipo errado' })).status).toBe(422);
      expect((await ger.post('/clientes', { tipoPessoa: 'PJ', nome: 'Sem documento' })).status).toBe(201);
    });
    it('Financeiro e Vistoriador não cadastram', async () => {
      expect((await fin.post('/clientes', { tipoPessoa: 'PF', nome: 'Nada' })).status).toBe(403);
      expect((await vis.post('/clientes', { tipoPessoa: 'PF', nome: 'Nada' })).status).toBe(403);
    });
    it('o cliente é do grupo: o Gerente da loja 2 também o vê; o Vistoriador vê só o nome; outro grupo não vê', async () => {
      const nome = `Revenda ${unico()}`;
      const id = (await adm.post('/clientes', { tipoPessoa: 'PJ', documento: gerarCnpj(), nome, emailsCobranca: ['cobranca@revenda.local'] })).body.id;
      expect(((await gerA2.get(`/clientes?busca=${nome}`)).body as { id: string }[]).map((c) => c.id)).toContain(id);
      const v = (await vis.get(`/clientes?busca=${nome}`)).body as Record<string, unknown>[];
      expect(Object.keys(v[0]!).sort()).toEqual(['id', 'nome']);
      expect((await vis.get(`/clientes/${id}`)).status).toBe(403);
      expect(((await admB.get(`/clientes?busca=${nome}`)).body as unknown[])).toHaveLength(0);
      expect((await admB.get(`/clientes/${id}`)).status).toBe(404);
    });
    it('configuração de faturamento e inativação', async () => {
      const id = (await ger.post('/clientes', { tipoPessoa: 'PJ', nome: `Locadora ${unico()}` })).body.id;
      const r = await ger.patch(`/clientes/${id}`, { periodicidade: 'QUINZENAL', prazoDias: 15, multaBp: 300, jurosMesBp: 150 });
      expect(r.body).toMatchObject({ periodicidade: 'QUINZENAL', prazoDias: 15, multaBp: 300, jurosMesBp: 150 });
      expect((await ger.patch(`/clientes/${id}`, { prazoDias: 9999 })).status).toBe(422);
      expect((await ger.patch(`/clientes/${id}`, { status: 'INATIVO' })).body.status).toBe('INATIVO');
    });
  });

  describe('preços do cliente (vigência)', () => {
    let clienteId: string; let servicoId: string;
    beforeAll(async () => {
      clienteId = (await adm.post('/clientes', { tipoPessoa: 'PJ', nome: `Auto Center ${unico()}` })).body.id;
      servicoId = (await adm.post('/servicos', { nome: `Cautelar ${unico()}` })).body.id;
    });

    it('o Gerente cadastra o primeiro preço; Financeiro e Vistoriador não', async () => {
      expect((await fin.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 18000 })).status).toBe(403);
      expect((await vis.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 18000 })).status).toBe(403);
      const r = await ger.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 18000, vigenciaIni: '2026-01-01' });
      expect(r.status).toBe(201);
      expect(r.body.valorCentavos).toBe(18000);
    });
    it('reajustar um preço que já existe é só do Administrativo, com motivo e data de hoje em diante', async () => {
      expect((await ger.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 19000, vigenciaIni: em(30), motivo: 'Reajuste anual' })).status).toBe(403);
      const semMotivo = await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 19000, vigenciaIni: em(30) });
      expect(semMotivo.status).toBe(422);
      const passado = await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 19000, vigenciaIni: '2026-02-01', motivo: 'Retroativo' });
      expect(passado.status).toBe(422);
      const ok = await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 19000, vigenciaIni: em(30), motivo: 'Reajuste anual' });
      expect(ok.status).toBe(201);
    });
    it('a vigência antiga é encerrada na véspera e o preço certo vale em cada data', async () => {
      const det = (await adm.get(`/clientes/${clienteId}`)).body.precos as { valorCentavos: number; vigenciaIni: string; vigenciaFim: string | null }[];
      const antigo = det.find((p) => p.valorCentavos === 18000)!;
      const novo = det.find((p) => p.valorCentavos === 19000)!;
      expect(novo.vigenciaFim).toBeNull();
      const vespera = new Date(Date.parse(novo.vigenciaIni.slice(0, 10)) - 86_400_000).toISOString().slice(0, 10);
      expect(antigo.vigenciaFim!.slice(0, 10)).toBe(vespera);
      const v = async (data: string) => (await vis.get(`/precos/vigente?clienteId=${clienteId}&servicoId=${servicoId}&data=${data}`)).body.preco?.valorCentavos ?? null;
      expect(await v(hoje())).toBe(18000);
      expect(await v(vespera)).toBe(18000);
      expect(await v(novo.vigenciaIni.slice(0, 10))).toBe(19000);
      expect(await v('2025-12-31')).toBeNull(); // antes de qualquer preço: o Vistoriador digita o valor
    });
    it('não aceita preço na mesma data do atual nem com data anterior', async () => {
      const r = await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 20000, vigenciaIni: em(30), motivo: 'Mesmo dia' });
      expect(r.status).toBe(409);
      expect((await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 20000, vigenciaIni: em(10), motivo: 'Antes do atual' })).status).toBe(409);
    });
    it('exige serviço e cliente ativos e valor em centavos inteiros', async () => {
      expect((await adm.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 180.5, motivo: 'x'.repeat(6) })).status).toBe(422);
      const inativo = (await adm.post('/servicos', { nome: `Antigo ${unico()}` })).body.id;
      await adm.patch(`/servicos/${inativo}`, { status: 'INATIVO' });
      expect((await ger.post(`/clientes/${clienteId}/precos`, { servicoId: inativo, valorCentavos: 10000 })).status).toBe(409);
    });
    it('o histórico é imutável no banco: nem a aplicação consegue mudar valor ou data gravados, nem sobrepor vigências', async () => {
      const ctx = { grupoId: cen.A.grupoId, rede: true, empresas: [] as string[] };
      await expect(db.tenant(ctx, (c) => c.query(`UPDATE cliente_preco SET valor_centavos = 1 WHERE cliente_id = $1`, [clienteId]))).rejects.toThrow(/não muda/);
      await expect(db.tenant(ctx, (c) => c.query(
        `INSERT INTO cliente_preco (grupo_id, cliente_id, servico_id, valor_centavos, vigencia_ini) VALUES ($1,$2,$3,5000,'2026-03-01')`, [cen.A.grupoId, clienteId, servicoId]))).rejects.toMatchObject({ code: '23P01' });
    });
    it('preços de um cliente são invisíveis a outro grupo', async () => {
      expect((await admB.get(`/precos/vigente?clienteId=${clienteId}&servicoId=${servicoId}`)).body.preco).toBeNull();
      expect((await admB.post(`/clientes/${clienteId}/precos`, { servicoId, valorCentavos: 100 })).status).toBe(404);
    });
  });

  describe('formas de pagamento', () => {
    it('Vistoriador vê só nome e tipo das formas ativas; Financeiro e Gerente veem as taxas', async () => {
      const v = (await vis.get('/formas-pagamento')).body as Record<string, unknown>[];
      expect(Object.keys(v[0]!).sort()).toEqual(['id', 'nome', 'tipo']);
      const f = (await fin.get('/formas-pagamento')).body as { empresas: unknown[] }[];
      expect(f[0]!.empresas).toBeDefined();
    });
    it('Administrativo cria e inativa; Gerente não', async () => {
      const r = await adm.post('/formas-pagamento', { nome: `Vale ${unico()}`, tipo: 'OUTRA' });
      expect(r.status).toBe(201);
      expect((await adm.post('/formas-pagamento', { nome: r.body.nome.toUpperCase(), tipo: 'OUTRA' })).status).toBe(409);
      expect((await ger.post('/formas-pagamento', { nome: 'Outra', tipo: 'OUTRA' })).status).toBe(403);
      expect((await adm.patch(`/formas-pagamento/${r.body.id}`, { status: 'INATIVO' })).body.status).toBe('INATIVO');
      expect(((await vis.get('/formas-pagamento')).body as { id: string }[]).map((x) => x.id)).not.toContain(r.body.id);
    });
    it('taxa, prazo e antecipação por loja: o Gerente só da própria loja', async () => {
      const credito = ((await adm.get('/formas-pagamento')).body as { id: string; tipo: string }[]).find((f) => f.tipo === 'CARTAO_CREDITO')!;
      const [a1, a2] = cen.A.empresaIds;
      const dados = { taxaBp: 269, prazoDias: 30, antecipacaoBp: 180 };
      expect((await ger.put(`/formas-pagamento/${credito.id}/empresas/${a1}`, dados)).body).toMatchObject(dados);
      expect((await ger.put(`/formas-pagamento/${credito.id}/empresas/${a2}`, dados)).status).toBe(403);
      expect((await ger.put(`/formas-pagamento/${credito.id}/empresas/${a1}`, { ...dados, taxaBp: 99999 })).status).toBe(422);
      expect((await fin.put(`/formas-pagamento/${credito.id}/empresas/${a1}`, dados)).status).toBe(403);
      const vistoPelaLoja2 = ((await gerA2.get('/formas-pagamento')).body as { id: string; empresas: { empresaId: string }[] }[]).find((f) => f.id === credito.id)!;
      expect(vistoPelaLoja2.empresas.map((e) => e.empresaId)).not.toContain(a1); // a taxa da loja 1 não vaza para a loja 2
    });
  });

  describe('vistoriadores', () => {
    it('Gerente cadastra na própria loja; não em loja alheia; CPF repetido dá 409', async () => {
      const [a1, a2] = cen.A.empresaIds;
      const doc = cpf();
      const ok = await ger.post('/vistoriadores', { nome: 'Ana Souza', cpf: doc, empresaIds: [a1] });
      expect(ok.status).toBe(201);
      expect((await ger.post('/vistoriadores', { nome: 'Fora', empresaIds: [a2] })).status).toBe(403);
      expect((await ger.post('/vistoriadores', { nome: 'Repetida', cpf: doc, empresaIds: [a1] })).status).toBe(409);
      expect((await ger.post('/vistoriadores', { nome: 'Sem loja', empresaIds: [] })).status).toBe(422);
    });
    it('cada loja vê só os próprios vistoriadores; o Administrativo vê todos', async () => {
      const [a1, a2] = cen.A.empresaIds;
      const n1 = `Só A1 ${unico()}`; const n2 = `Só A2 ${unico()}`;
      await ger.post('/vistoriadores', { nome: n1, empresaIds: [a1] });
      await gerA2.post('/vistoriadores', { nome: n2, empresaIds: [a2] });
      const nomes = async (c: ReturnType<typeof cliente>) => ((await c.get('/vistoriadores')).body as { nome: string }[]).map((v) => v.nome);
      expect(await nomes(ger)).toContain(n1); expect(await nomes(ger)).not.toContain(n2);
      expect(await nomes(gerA2)).toContain(n2); expect(await nomes(gerA2)).not.toContain(n1);
      expect(await nomes(adm)).toEqual(expect.arrayContaining([n1, n2]));
      expect(await nomes(admB)).not.toContain(n1);
    });
    it('Gerente de uma loja não tira um vistoriador de outra loja onde ele também atua', async () => {
      const [a1, a2] = cen.A.empresaIds;
      const id = (await adm.post('/vistoriadores', { nome: `Nas duas ${unico()}`, empresaIds: [a1, a2] })).body.id;
      const r = await ger.patch(`/vistoriadores/${id}`, { empresaIds: [] as string[] });
      expect(r.status).toBe(422); // lista vazia não vale
      const sai = await ger.patch(`/vistoriadores/${id}`, { empresaIds: [a2] }); // tira só a loja 1 (a dele)
      expect(sai.status).toBe(200);
      expect(sai.body.empresaIds).toEqual([]); // do ponto de vista do Gerente da loja 1, não sobrou nenhuma loja dele
      const detalhe = ((await adm.get('/vistoriadores')).body as { id: string; empresaIds: string[] }[]).find((v) => v.id === id)!;
      expect(detalhe.empresaIds).toEqual([a2]); // a loja 2 continua
    });
    it('Financeiro lista; Vistoriador não acessa', async () => {
      expect((await fin.get('/vistoriadores')).status).toBe(200);
      expect((await vis.get('/vistoriadores')).status).toBe(403);
      expect((await fin.post('/vistoriadores', { nome: 'Nada', empresaIds: [cen.A.empresaIds[0]] })).status).toBe(403);
    });
  });

  describe('contas financeiras e dados da fatura', () => {
    const completa = (extra: object = {}) => ({ nome: `Itaú ${unico()}`, tipo: 'BANCO', banco: 'Itaú (341)', agencia: '1234', conta: '12345-6', tipoConta: 'CORRENTE', titular: 'Centro Vistorias Ltda', documentoTitular: '11222333000181', pixTipo: 'CNPJ', pixChave: '11.222.333/0001-81', ...extra });
    const a1 = () => cen.A.empresaIds[0]!;

    it('conta que não aparece na fatura é cadastrada sem confirmação', async () => {
      const r = await ger.post('/contas-financeiras', { empresaId: a1(), ...completa() });
      expect(r.status).toBe(201);
      expect(r.body.conta).toMatchObject({ exibirNaFatura: false, banco: 'Itaú (341)', documentoTitular: '11222333000181' });
      expect(r.body.pedido).toBeNull();
      expect((await ger.post('/contas-financeiras', { empresaId: a1(), nome: 'Caixa da loja', tipo: 'CAIXA', saldoInicialCentavos: 150000 })).status).toBe(201);
    });
    it('Administrativo que mostra a conta na fatura precisa da própria senha', async () => {
      const dto = { empresaId: a1(), ...completa(), exibirNaFatura: true };
      expect((await adm.post('/contas-financeiras', dto)).status).toBe(422); // sem senha
      expect((await adm.post('/contas-financeiras', { ...dto, senha: 'senha-errada-99' })).status).toBe(403);
      const ok = await adm.post('/contas-financeiras', { ...dto, senha: SENHA });
      expect(ok.status).toBe(201);
      expect(ok.body.conta.exibirNaFatura).toBe(true);
    });
    it('conta incompleta não pode aparecer na fatura', async () => {
      const r = await adm.post('/contas-financeiras', { empresaId: a1(), nome: 'Incompleta', tipo: 'BANCO', banco: 'Itaú (341)', exibirNaFatura: true, senha: SENHA });
      expect(r.status).toBe(422);
      expect(Object.keys(r.body.campos)).toEqual(expect.arrayContaining(['titular', 'documentoTitular']));
      expect((await adm.post('/contas-financeiras', { empresaId: a1(), ...completa({ pixChave: '11.222.333/0001-99' }) })).status).toBe(422); // chave PIX inválida
    });

    describe('pedido do Gerente e aprovação', () => {
      let contaId: string; let pedidoId: string;
      it('conta nova do Gerente com "mostrar na fatura" nasce escondida e vira pedido', async () => {
        const r = await ger.post('/contas-financeiras', { empresaId: a1(), ...completa(), exibirNaFatura: true });
        expect(r.status).toBe(201);
        expect(r.body.conta.exibirNaFatura).toBe(false);
        expect(r.body.pedido.id).toBeTruthy();
        contaId = r.body.conta.id; pedidoId = r.body.pedido.id;
      });
      it('só o Administrativo vê o pedido como decisão; Gerente não aprova, nem com a senha certa', async () => {
        expect((await ger.post(`/contas-financeiras/pedidos/${pedidoId}/aprovar`, { senha: SENHA })).status).toBe(403);
        expect((await fin.post(`/contas-financeiras/pedidos/${pedidoId}/aprovar`, { senha: SENHA })).status).toBe(403);
        const pend = (await adm.get('/contas-financeiras/pedidos?status=PENDENTE')).body as { id: string; solicitadoPor: string }[];
        expect(pend.find((p) => p.id === pedidoId)!.solicitadoPor).toBe('Gerente A1');
      });
      it('enquanto há pedido pendente a conta continua como estava e não aceita outro pedido', async () => {
        const lista = (await adm.get('/contas-financeiras')).body as { id: string; exibirNaFatura: boolean; pedidoPendente: { id: string } | null }[];
        const c = lista.find((x) => x.id === contaId)!;
        expect(c.exibirNaFatura).toBe(false);
        expect(c.pedidoPendente!.id).toBe(pedidoId);
        const outro = await ger.patch(`/contas-financeiras/${contaId}`, { exibirNaFatura: true });
        expect(outro.status).toBe(409);
      });
      it('aprovar exige a senha do Administrativo; com ela a conta passa a aparecer na fatura', async () => {
        expect((await adm.post(`/contas-financeiras/pedidos/${pedidoId}/aprovar`, { senha: 'senha-errada-99' })).status).toBe(403);
        const ok = await adm.post(`/contas-financeiras/pedidos/${pedidoId}/aprovar`, { senha: SENHA });
        expect(ok.status).toBe(201);
        expect(ok.body.conta.exibirNaFatura).toBe(true);
        expect((await adm.post(`/contas-financeiras/pedidos/${pedidoId}/aprovar`, { senha: SENHA })).status).toBe(404); // já decidido
      });
      it('depois de aparecer na fatura, trocar a chave PIX ou o banco vira pedido do Gerente e a conta não muda até aprovar', async () => {
        const r = await ger.patch(`/contas-financeiras/${contaId}`, { pixTipo: 'EMAIL', pixChave: 'financeiro@centro.local' });
        expect(r.status).toBe(200);
        expect(r.body.pedido.id).toBeTruthy();
        expect(r.body.conta.pixTipo).toBe('CNPJ'); // intacta
        const rej = await adm.post(`/contas-financeiras/pedidos/${r.body.pedido.id}/rejeitar`, { motivo: 'Chave não conferida com o banco' });
        expect(rej.status).toBe(201);
        const lista = (await adm.get('/contas-financeiras')).body as { id: string; pixTipo: string }[];
        expect(lista.find((x) => x.id === contaId)!.pixTipo).toBe('CNPJ');
      });
      it('mudar o nome da conta que aparece na fatura não precisa de confirmação', async () => {
        const r = await ger.patch(`/contas-financeiras/${contaId}`, { nome: 'Itaú principal' });
        expect(r.status).toBe(200);
        expect(r.body.pedido).toBeNull();
        expect(r.body.conta.nome).toBe('Itaú principal');
      });
      it('o Administrativo altera direto, mas com a senha', async () => {
        expect((await adm.patch(`/contas-financeiras/${contaId}`, { banco: 'Bradesco (237)' })).status).toBe(422);
        const r = await adm.patch(`/contas-financeiras/${contaId}`, { banco: 'Bradesco (237)', senha: SENHA });
        expect(r.status).toBe(200);
        expect(r.body.conta.banco).toBe('Bradesco (237)');
      });
      it('tudo isso fica no log, com o antes e o depois', async () => {
        const log = (await adm.get(`/auditoria?entidade=conta_financeira&entidadeId=${contaId}&limite=50`)).body.itens as { acao: string; antes: { banco?: string } | null; depois: { banco?: string } | null }[];
        const acoes = log.map((l) => l.acao);
        expect(acoes).toEqual(expect.arrayContaining(['conta_financeira.criada', 'conta_financeira.pedido_aberto', 'conta_financeira.pedido_aprovado', 'conta_financeira.pedido_rejeitado', 'conta_financeira.alteracao_confirmada']));
        const alt = log.find((l) => l.acao === 'conta_financeira.alteracao_confirmada')!;
        expect(alt.antes!.banco).toBe('Itaú (341)'); expect(alt.depois!.banco).toBe('Bradesco (237)');
      });
    });

    it('errar a senha de confirmação repetidas vezes bloqueia', async () => {
      const c = await entrar('adminA');
      const dto = { empresaId: a1(), ...completa(), exibirNaFatura: true };
      let ultimo = 0;
      for (let i = 0; i < 7; i++) ultimo = (await c.post('/contas-financeiras', { ...dto, senha: 'errada-errada-1' })).status;
      expect(ultimo).toBe(429);
    });

    it('cada loja vê só as próprias contas; Financeiro só consulta; Vistoriador não acessa', async () => {
      const a2 = cen.A.empresaIds[1]!;
      const nome = `Conta A2 ${unico()}`;
      await gerA2.post('/contas-financeiras', { empresaId: a2, nome, tipo: 'CAIXA' });
      const nomes = async (c: ReturnType<typeof cliente>) => ((await c.get('/contas-financeiras')).body as { nome: string }[]).map((x) => x.nome);
      expect(await nomes(gerA2)).toContain(nome);
      expect(await nomes(ger)).not.toContain(nome);
      expect(await nomes(admB)).not.toContain(nome);
      expect((await ger.post('/contas-financeiras', { empresaId: a2, nome: 'Invasão', tipo: 'CAIXA' })).status).toBe(403);
      expect((await fin.get('/contas-financeiras')).status).toBe(200);
      expect((await fin.post('/contas-financeiras', { empresaId: a1(), nome: 'Nova', tipo: 'CAIXA' })).status).toBe(403);
      expect((await vis.get('/contas-financeiras')).status).toBe(403);
    });
  });

  it('as telas de cadastro não deixam os grupos se enxergarem (varredura)', async () => {
    for (const rota of ['/clientes', '/servicos', '/fornecedores', '/formas-pagamento', '/vistoriadores', '/contas-financeiras', '/plano-contas']) {
      const a = ((await adm.get(rota)).body as { id: string }[]).map((x) => x.id);
      const b = ((await admB.get(rota)).body as { id: string }[]).map((x) => x.id);
      expect(a.filter((id) => b.includes(id)), rota).toEqual([]);
    }
  });
});
