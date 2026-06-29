import { useQuery, useMutation } from '@tanstack/react-query';

export function useAnalyses(connectionId: string, action?: string, limit?: number) {
  return useQuery({
    queryKey: ['analyses', connectionId, action, limit],
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('connectionId', connectionId);
      if (action) qs.set('action', action);
      if (limit) qs.set('limit', String(limit));
      const res = await fetch(`/api/analysis?${qs}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to load analyses');
      return res.json();
    },
    enabled: !!connectionId,
  });
}

export function useAnalyze() {
  return useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Analysis failed');
      }
      return res.json();
    },
  });
}

export function useSaveAnalysis() {
  return useMutation({
    mutationFn: async (body: Record<string, any>) => {
      await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  });
}
