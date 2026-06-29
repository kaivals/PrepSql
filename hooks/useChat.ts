import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function chatKey(connectionId: string) {
  return ['chat', connectionId] as const;
}

export function useChat(connectionId: string | undefined) {
  return useQuery({
    queryKey: connectionId ? chatKey(connectionId) : ['chat', null],
    queryFn: async () => {
      const res = await fetch(
        `/api/chat?connectionId=${encodeURIComponent(connectionId!)}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) return { messages: [] };
      return res.json() as Promise<{ messages: any[] }>;
    },
    enabled: !!connectionId,
  });
}

export function usePersistChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { connectionId: string; messages: any[] }) => {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKey(variables.connectionId) });
    },
  });
}
