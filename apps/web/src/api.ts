import { criarApi } from '@ecv/ui';

export const api = criarApi(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
