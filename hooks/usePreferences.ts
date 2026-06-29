import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export const PREFERENCES_KEY = ['preferences'] as const;

export function usePreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: async () => {
      const res = await fetch('/api/preferences', { credentials: 'same-origin' });
      if (!res.ok) return {} as Record<string, any>;
      const data = await res.json();
      return (data.preferences || {}) as Record<string, any>;
    },
  });
}

export function useSavePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ preferences: { [key]: value } }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
    },
  });
}
