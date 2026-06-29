import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export const SCHEMA_KEY = ['schema'] as const;

export function useSchema(enabled = true) {
  return useQuery({
    queryKey: SCHEMA_KEY,
    queryFn: async () => {
      const res = await fetch('/api/schema');
      if (!res.ok) throw new Error('Failed to load schema');
      return res.json() as Promise<{ tables: any[] }>;
    },
    enabled,
  });
}

export function useNullCheck() {
  return useMutation({
    mutationFn: async (body: {
      table: string | null;
      columns: { columnName: string; type: string }[];
    }) => {
      const res = await fetch('/api/schema/null-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { columns: [], needsBackfill: false };
      return res.json();
    },
  });
}
