import { useMutation } from '@tanstack/react-query';

export function useExecuteSQL() {
  return useMutation({
    mutationFn: async (sql: string) => {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sql }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Query execution failed');
      }
      return res.json();
    },
  });
}
