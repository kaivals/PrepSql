import { useMutation } from '@tanstack/react-query';

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
    mutationFn: async (body: {
      action: string;
      targetSql: string | null;
      result: Record<string, unknown>;
    }) => {
      await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  });
}
