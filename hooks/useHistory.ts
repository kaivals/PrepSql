import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface UseHistoryParams {
  limit?: number;
  offset?: number;
  connectionId?: string;
  /** Set to false to disable the query (default: true) */
  enabled?: boolean;
}

export function historyKey(params: Omit<UseHistoryParams, 'enabled'>) {
  return ['history', params] as const;
}

export function useHistory(params: UseHistoryParams = {}) {
  const { limit = 500, offset, connectionId, enabled = true } = params;

  return useQuery({
    queryKey: historyKey({ limit, offset, connectionId }),
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('limit', String(limit));
      if (offset != null) qs.set('offset', String(offset));
      if (connectionId) qs.set('connectionId', connectionId);
      qs.set('t', String(Date.now()));

      const res = await fetch(`/api/history?${qs}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to load history');
      const data = await res.json();
      return data.history || [];
    },
    enabled,
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear history');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}
