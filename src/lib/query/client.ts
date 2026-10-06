import { QueryClient } from '@tanstack/react-query';

// One client for the application lifetime; features may override defaults per operation.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      networkMode: 'online',
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
      networkMode: 'online',
    },
  },
});
