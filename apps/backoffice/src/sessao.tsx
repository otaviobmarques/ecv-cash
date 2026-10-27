import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErroApi } from '@ecv/ui';
import { api } from './api';
import type { Interno } from './tipos';

export function useInterno() {
  return useQuery({
    queryKey: ['interno'],
    queryFn: async () => {
      try { return await api.get<Interno>('/backoffice/auth/eu'); }
      catch (e) { if (e instanceof ErroApi && e.status === 401) return null; throw e; }
    },
    staleTime: 60_000, retry: false,
  });
}

export function useSessaoInterna() {
  const qc = useQueryClient();
  return {
    definir: (i: Interno | null) => { qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'interno' }); qc.setQueryData(['interno'], i); },
    sair: async () => { await api.post('/backoffice/auth/logout'); qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'interno' }); qc.setQueryData(['interno'], null); },
  };
}
