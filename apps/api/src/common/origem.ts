import type { NextFunction, Request, Response } from 'express';

/**
 * Uma entrada pode ter "*" para um trecho de endereço (letras, números e hífen, sem ponto), útil para os vários
 * endereços que a Vercel dá ao mesmo site: "https://ecv-cash-app*-redbox6.vercel.app".
 */
export function origemPermitida(permitidas: string[]): (origem: string) => boolean {
  const exatas = new Set(permitidas.filter((p) => !p.includes('*')));
  const padroes = permitidas.filter((p) => p.includes('*'))
    .map((p) => new RegExp(`^${p.split('*').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]*')}$`));
  return (origem) => exatas.has(origem) || padroes.some((r) => r.test(origem));
}

/** Defesa de CSRF para o cookie de sessão: mutações só de origens autorizadas. */
export function exigirOrigemPermitida(permitidas: string[]) {
  const permitida = origemPermitida(permitidas);
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origem = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const ok = origem ? permitida(origem) : !site || site === 'same-origin' || site === 'none';
    if (!ok) return res.status(403).json({ mensagem: 'Origem não autorizada.' });
    next();
  };
}
