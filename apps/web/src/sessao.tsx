import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErroApi } from '@ecv/ui';
import { api } from './api';
import type { Eu } from './tipos';

export function useEu() {
  return useQuery({
    queryKey: ['eu'],
    queryFn: async () => {
      try {
        return await api.get<Eu>('/auth/eu');
      } catch (e) {
        if (e instanceof ErroApi && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSessao() {
  const qc = useQueryClient();
  return {
    definir: (eu: Eu | null) => { qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'eu' }); qc.setQueryData(['eu'], eu); },
    sair: async () => { await api.post('/auth/logout'); qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'eu' }); qc.setQueryData(['eu'], null); },
  };
}

export const pode = (eu: Eu | null | undefined, p: Eu['permissoes'][number]) => !!eu?.permissoes.includes(p);
