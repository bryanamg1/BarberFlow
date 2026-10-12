import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ComponentType, PropsWithChildren, ReactElement } from 'react';

import { createTestQueryClient, registerTestQueryClient } from './createTestQueryClient';

export type TestRenderOptions = {
  queryClient?: QueryClient;
  wrapper?: ComponentType<PropsWithChildren>;
};

export async function renderWithProviders(
  ui: ReactElement,
  { queryClient = createTestQueryClient(), wrapper: ExtraProvider }: TestRenderOptions = {},
) {
  registerTestQueryClient(queryClient);

  function TestProviders({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {ExtraProvider ? <ExtraProvider>{children}</ExtraProvider> : children}
      </QueryClientProvider>
    );
  }

  return { ...(await render(ui, { wrapper: TestProviders })), queryClient };
}
