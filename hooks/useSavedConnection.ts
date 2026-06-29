import { useMutation } from '@tanstack/react-query';

export function useClearSavedConnection() {
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/saved-connection', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    },
  });
}
