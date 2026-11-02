import { criarApi } from '@ecv/ui';

/** Endereço da API (nas publicações, /api no mesmo domínio). */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const api = criarApi(API_BASE);
