import { useMutation } from '@tanstack/react-query';

export interface AnalyzeParams {
  action: 'timeline' | 'db' | 'query';
  timeline?: any[];
  history?: any[];
  sql?: string;
}

export function useAnalyze() {
  return useMutation<any, Error, AnalyzeParams>({
    mutationFn: async (params) => {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Analysis failed');
      }

      return res.json();
    },
  });
}
