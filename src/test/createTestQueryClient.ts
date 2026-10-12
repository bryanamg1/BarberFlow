import { QueryClient } from '@tanstack/react-query';

// Track ownership for cleanup, never share a client/cache between tests.
const clients = new Set<QueryClient>();

export function createTestQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return registerTestQueryClient(client);
}

export function registerTestQueryClient(client: QueryClient): QueryClient {
  clients.add(client);
  return client;
}

export function clearTestQueryClients(): void {
  for (const client of clients) client.clear();
  clients.clear();
}
