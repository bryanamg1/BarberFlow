import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@/features/auth/context/AuthContext';
import { queryClient } from '@/lib/query/client';

let mockCallback: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
let mockRecovering = false;
const mockRead = jest.fn();
jest.mock('@/features/auth/services/authService', () => ({
  authService: {
    getSession: () => mockRead(),
    isRecoveryPending: (session: Session | null) => !!session && mockRecovering,
    onAuthStateChange: (callback: typeof mockCallback) => {
      mockCallback = callback;
      return {
        unsubscribe: () => {
          mockCallback = undefined;
        },
      };
    },
  },
}));
const session = (id: string) => ({ user: { id } }) as Session;
function Probe() {
  const auth = useAuth();
  const oldData = queryClient.getQueryData(['clients', 'a']);
  return (
    <Text testID="state">{`${auth.status}/${auth.user?.id ?? '-'}/${oldData ? 'old-cache' : 'clean'}`}</Text>
  );
}
async function boot() {
  mockRead.mockResolvedValue({ data: { session: session('a') }, error: null });
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('state')).toHaveTextContent('authenticated/a/clean'),
  );
  queryClient.setQueryData(['clients', 'a'], { private: 'a' });
}
beforeEach(() => {
  queryClient.clear();
  mockRead.mockReset();
  mockRecovering = false;
});
afterEach(() => queryClient.clear());
test.each(['SIGNED_OUT', 'INITIAL_SESSION'] as const)(
  '%s/null clears A before anonymous render',
  async (event) => {
    await boot();
    await act(() => mockCallback?.(event, null));
    expect(screen.getByTestId('state')).toHaveTextContent('unauthenticated/-/clean');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  },
);
test('A -> B clears before B is exposed; duplicate B events do not clear B', async () => {
  await boot();
  await act(() => mockCallback?.('SIGNED_IN', session('b')));
  expect(screen.getByTestId('state')).toHaveTextContent('authenticated/b/clean');
  queryClient.setQueryData(['clients', 'b'], { private: 'b' });
  await act(() => mockCallback?.('SIGNED_IN', session('b')));
  expect(queryClient.getQueryData(['clients', 'b'])).toEqual({ private: 'b' });
});
test('TOKEN_REFRESHED same A preserves exact query object and data', async () => {
  await boot();
  const query = queryClient.getQueryCache().getAll()[0];
  const data = query.state.data;
  await act(() => mockCallback?.('TOKEN_REFRESHED', { ...session('a'), expires_at: 999999 }));
  expect(screen.getByTestId('state')).toHaveTextContent('authenticated/a/old-cache');
  expect(queryClient.getQueryCache().getAll()[0]).toBe(query);
  expect(query.state.data).toBe(data);
});
test('A -> recovery clears before recovery UI; session is not normal identity', async () => {
  await boot();
  mockRecovering = true;
  await act(() => mockCallback?.('PASSWORD_RECOVERY', session('a')));
  expect(screen.getByTestId('state')).toHaveTextContent('recovering/a/clean');
});
test('bootstrap error also clears an untrusted previous provider cache', async () => {
  queryClient.setQueryData(['clients', 'a'], { private: 'a' });
  mockRead.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Safe error' },
  });
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error/-/clean'));
});
