import type { QueryClient } from '@tanstack/react-query';

import { queryClient } from './client';

export function clearPrivateQueryState(client: QueryClient = queryClient): void {
  // Current query/mutation families are all authenticated user/business data; assets/theme
  // do not use this cache. Introduce an explicit classifier before adding public queries.
  // cancelQueries cancels retryers synchronously, including queryFns ignoring AbortSignal.
  void client.cancelQueries();
  client.clear();
  // Clearing mutation bookkeeping does not undo a server write; feature intent guards remain.
}
