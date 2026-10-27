import type { NextFunction, Request, Response } from 'express';

/** Defesa de CSRF para o cookie de sessão: mutações só de origens autorizadas. */
export function exigirOrigemPermitida(permitidas: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origem = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const ok = origem ? permitidas.includes(origem) : !site || site === 'same-origin' || site === 'none';
    if (!ok) return res.status(403).json({ mensagem: 'Origem não autorizada.' });
    next();
  };
}
