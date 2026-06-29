import { useMutation } from '@tanstack/react-query';
import type { QueryResult } from '@/lib/types';

export interface ExecuteParams {
  sql: string;
}

export function useExecute() {
  return useMutation<QueryResult, Error, ExecuteParams>({
    mutationFn: async ({ sql }) => {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Query execution failed');
      }

      return res.json();
    },
  });
}
