import { QueryClientProvider, notifyManager, defaultScheduler } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { HomeKpis } from '@/features/analytics/components/HomeKpis';
import { useHomeDashboardSummary } from '@/features/analytics/hooks/useHomeDashboardSummary';
import { analyticsKeys } from '@/features/analytics/constants/analyticsKeys';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { agendaContext } from './helpers/agendaFixture';
import { financeSummary } from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const focused = jest.fn();
  return {
    useIsFocused: focused,
    useFocusEffect: (callback: () => void) => {
      const active = focused();
      React.useEffect(() => (active ? callback() : undefined), [callback, active]);
    },
  };
});
jest.mock('@/lib/supabase/client', () => {
  const { createClient } = jest.requireActual('@supabase/supabase-js');
  const http = jest.fn();
  return {
    http,
    supabase: createClient('https://home-unit.example', 'test-only-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (...args: unknown[]) => http(...args) },
    }),
  };
});
const { http } = jest.requireMock<{ http: jest.Mock }>('@/lib/supabase/client');
beforeEach(() => {
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:00:00Z'));
  notifyManager.setScheduler(queueMicrotask);
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

const response = () =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => JSON.stringify(financeSummary()),
  }) as Response;

test('real hook/service/repository/SDK share one pending HTTP request and survive one consumer unmount', async () => {
  let resolve!: (value: Response) => void;
  http.mockImplementation(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity } });
  function Consumer() {
    const result = useHomeDashboardSummary();
    return <HomeKpis result={result} />;
  }
  const element = (first = true) => (
    <QueryClientProvider client={client}>
      {first && <Consumer key="first" />}
      <Consumer key="second" />
    </QueryClientProvider>
  );
  const view = await render(element());
  await waitFor(() => expect(http).toHaveBeenCalledTimes(1));
  const [url, init] = http.mock.calls[0] as [string, RequestInit];
  expect(new URL(url).pathname).toBe('/rest/v1/rpc/get_dashboard_summary');
  expect(JSON.parse(init.body as string)).toEqual({
    p_business_id: 'b',
    p_from: '2026-10-28T00:00:00.000Z',
    p_to: '2026-10-29T00:00:00.000Z',
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  await view.rerender(element(false));
  expect(init.signal!.aborted).toBe(false);
  await act(async () => resolve(response()));
  await waitFor(() => expect(screen.getByLabelText('Turnos de hoy: 2')).toBeTruthy());
  const key = analyticsKeys.resource(
    'summary',
    { userId: 'u', businessId: 'b', membershipId: 'm', timezone: 'UTC' },
    { from: '2026-10-28T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z' },
  );
  expect(client.getQueryData(key)).toEqual(financeSummary());
  expect(http).toHaveBeenCalledTimes(1);
});

test('equivalent pre-existing Analytics summary cache is reused without a parallel Home key/request', async () => {
  http.mockResolvedValue(response());
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity } });
  const key = analyticsKeys.resource(
    'summary',
    { userId: 'u', businessId: 'b', membershipId: 'm', timezone: 'UTC' },
    { from: '2026-10-28T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z' },
  );
  client.setQueryData(key, financeSummary());
  function Consumer() {
    const result = useHomeDashboardSummary();
    return <HomeKpis result={result} />;
  }
  await render(
    <QueryClientProvider client={client}>
      <Consumer />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText('Turnos de hoy: 2')).toBeTruthy());
  expect(http).not.toHaveBeenCalled();
});
