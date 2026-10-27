import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErroApi, criarApi } from './api';
import { aplicarTema } from './tema';
import { formatarData, formatarDataHora } from './formatar';

afterEach(() => vi.unstubAllGlobals());

const resposta = (status: number, corpo?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo }) as Response;

describe('cliente da API', () => {
  it('manda o cookie e o corpo em JSON', async () => {
    const f = vi.fn().mockResolvedValue(resposta(200, { ok: 1 }));
    vi.stubGlobal('fetch', f);
    await criarApi('http://api').post('/x', { a: 1 });
    expect(f).toHaveBeenCalledWith('http://api/x', expect.objectContaining({ method: 'POST', credentials: 'include', body: '{"a":1}' }));
  });
  it('traduz erro de validação com os campos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(422, { mensagem: 'Confira os campos.', campos: { email: 'E-mail inválido.' } })));
    const e = (await criarApi('').get('/x').catch((x) => x)) as ErroApi;
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 422, message: 'Confira os campos.', campos: { email: 'E-mail inválido.' } });
  });
  it('204 devolve vazio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(204)));
    expect(await criarApi('').post('/x')).toBeUndefined();
  });
  it('sem rede, dá uma mensagem que ajuda e não vaza detalhe técnico', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const e = (await criarApi('').get('/x').catch((x) => x)) as ErroApi;
    expect(e.status).toBe(0);
    expect(e.message).toMatch(/conexão/i);
    expect(e.message).not.toMatch(/fetch/i);
  });
  it('erro sem corpo cai numa mensagem padrão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => { throw new Error('x'); } }));
    expect(((await criarApi('').get('/x').catch((x) => x)) as ErroApi).message).toMatch(/algo deu errado/i);
  });
});

describe('tema', () => {
  it('aplica as cores do cliente e volta ao padrão sem tema', () => {
    const r = document.documentElement.style;
    aplicarTema({ marca: '#0B5ED7', marcaHover: '#0949A8', textoSobreMarca: '#FFFFFF' });
    expect(r.getPropertyValue('--brand')).toBe('#0B5ED7');
    expect(r.getPropertyValue('--brand-ink')).toBe('#FFFFFF');
    aplicarTema(null);
    expect(r.getPropertyValue('--brand')).toBe('');
  });
});

describe('datas', () => {
  it('formata no fuso de São Paulo, em dd/mm/aaaa', () => {
    expect(formatarData('2026-10-27T02:30:00Z')).toBe('26/10/2026');
    expect(formatarDataHora('2026-10-27T20:33:00Z')).toMatch(/27\/10\/2026.*17:33/);
    expect(formatarData(null)).toBe('—');
  });
});
