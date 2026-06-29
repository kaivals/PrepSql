import { useMutation } from '@tanstack/react-query';

export function useGenerate() {
  return useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate SQL');
      }
      return res.json();
    },
  });
}
