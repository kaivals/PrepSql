import { useMutation } from '@tanstack/react-query';

export function useDemo() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create demo DB');
      return data;
    },
  });
}
