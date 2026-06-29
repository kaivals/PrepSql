import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export const MODE_KEY = ['mode'] as const;

export function useMode() {
  return useQuery({
    queryKey: MODE_KEY,
    queryFn: async () => {
      const res = await fetch('/api/mode');
      if (!res.ok) return { mode: 'readonly' };
      return res.json() as Promise<{ mode: string }>;
    },
  });
}

export function useSaveMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: string) => {
      await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MODE_KEY });
    },
  });
}
