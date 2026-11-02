import { ErroApi, criarApi } from '@ecv/ui';

/** Endereço da API (nas publicações, /api no mesmo domínio). */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const api = criarApi(API_BASE);

/** Envia um arquivo (multipart). Os erros voltam no mesmo formato do restante da API. */
export async function enviarArquivo<T>(url: string, arquivo: File): Promise<T> {
  const corpo = new FormData(); corpo.append('arquivo', arquivo);
  let r: Response;
  try { r = await fetch(API_BASE + url, { method: 'POST', credentials: 'include', body: corpo }); }
  catch { throw new ErroApi('Não foi possível enviar o arquivo. Confira sua conexão e tente de novo.', 0); }
  const json = await r.json().catch(() => ({}) as Record<string, unknown>);
  if (!r.ok) throw new ErroApi((json.mensagem as string) ?? 'Não foi possível enviar o arquivo.', r.status, json.campos as Record<string, string> | undefined, json);
  return json as T;
}
