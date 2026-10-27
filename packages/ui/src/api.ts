export class ErroApi extends Error {
  constructor(mensagem: string, readonly status: number, readonly campos?: Record<string, string>) {
    super(mensagem);
  }
}

/** Cliente HTTP da API: cookie de sessão sempre junto, erros no formato { mensagem, campos }. */
export function criarApi(base: string) {
  async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await fetch(base + url, {
        method: metodo,
        credentials: 'include',
        headers: corpo === undefined ? undefined : { 'content-type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new ErroApi('Não foi possível falar com o servidor. Confira sua conexão e tente de novo.', 0);
    }
    if (r.status === 204) return undefined as T;
    const json = await r.json().catch(() => ({}) as Record<string, unknown>);
    if (!r.ok) throw new ErroApi((json.mensagem as string) ?? 'Algo deu errado. Tente de novo em instantes.', r.status, json.campos as Record<string, string> | undefined);
    return json as T;
  }
  return {
    get: <T>(url: string) => req<T>('GET', url),
    post: <T = void>(url: string, corpo?: unknown) => req<T>('POST', url, corpo ?? {}),
    put: <T>(url: string, corpo: unknown) => req<T>('PUT', url, corpo),
    patch: <T>(url: string, corpo: unknown) => req<T>('PATCH', url, corpo),
  };
}
export type Api = ReturnType<typeof criarApi>;
