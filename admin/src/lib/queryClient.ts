import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: Infinity, // Replays are immutable
      retry: false,
    },
  },
});
