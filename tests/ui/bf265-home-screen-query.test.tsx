import { QueryClientProvider, notifyManager, defaultScheduler } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { HomeScreen } from '@/features/analytics/screens/HomeScreen';
import { analyticsKeys } from '@/features/analytics/constants/analyticsKeys';
import { useNextAppointment } from '@/features/analytics/hooks/useNextAppointment';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { agendaContext } from './helpers/agendaFixture';
import { financeSummary } from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react'),
    focused = jest.fn();
  return {
    router: { push: jest.fn() },
    useIsFocused: focused,
    useFocusEffect: (callback: () => void) => {
      const active = focused();
      React.useEffect(() => (active ? callback() : undefined), [active, callback]);
    },
  };
});
jest.mock('@/features/analytics/hooks/useNextAppointment', () => ({
  useNextAppointment: jest.fn(),
}));
// These independently-querying producers are exercised in their unchanged related
// suites; this integration leaves the actual financial hook/service/SDK intact.
jest.mock('@/features/analytics/components/HomeTodayAppointments', () => ({
  HomeTodayAppointments: () => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, 'Today operativo');
  },
}));
jest.mock('@/features/analytics/components/HomeLowStock', () => ({
  HomeLowStock: () => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, 'Stock operativo');
  },
}));
jest.mock('@/lib/supabase/client', () => {
  const { createClient } = jest.requireActual('@supabase/supabase-js'),
    http = jest.fn();
  return {
    http,
    supabase: createClient('https://home-screen-unit.example', 'test-only-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (...args: unknown[]) => http(...args) },
    }),
  };
});
const { http } = jest.requireMock<{ http: jest.Mock }>('@/lib/supabase/client');
const response = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    statusText: status === 200 ? 'OK' : 'Forbidden',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => JSON.stringify(data),
  }) as Response;
beforeEach(() => {
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(useNextAppointment).mockReturnValue({ status: 'success', data: null });
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T12:00:00Z'));
  notifyManager.setScheduler(queueMicrotask);
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

test('real HomeScreen financial consumers share exactly one BF240 HTTP request and canonical cache entry', async () => {
  let resolve!: (value: Response) => void;
  http.mockImplementation(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  const client = createTestQueryClient();
  await render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(http).toHaveBeenCalledTimes(1));
  const [url, init] = http.mock.calls[0] as [string, RequestInit];
  expect(new URL(url).pathname).toBe('/rest/v1/rpc/get_dashboard_summary');
  expect(JSON.parse(init.body as string)).toEqual({
    p_business_id: 'b',
    p_from: '2026-10-29T00:00:00.000Z',
    p_to: '2026-10-30T00:00:00.000Z',
  });
  await act(async () => resolve(response(financeSummary())));
  await waitFor(() => expect(screen.getByLabelText('Turnos de hoy: 2')).toBeTruthy());
  expect(screen.getByLabelText(/^Ingresos de hoy:/)).toBeTruthy();
  expect(screen.getByLabelText(/^Ingresos:/)).toBeTruthy();
  expect(screen.getByLabelText(/^Ganancia:/)).toBeTruthy();
  expect(screen.getByText('No hay próximos turnos')).toBeTruthy();
  expect(screen.getByText('Today operativo')).toBeTruthy();
  expect(screen.getByText('Stock operativo')).toBeTruthy();
  expect(http).toHaveBeenCalledTimes(1);
  const key = analyticsKeys.resource(
    'summary',
    { userId: 'u', businessId: 'b', membershipId: 'm', timezone: 'UTC' },
    { from: '2026-10-29T00:00:00.000Z', to: '2026-10-30T00:00:00.000Z' },
  );
  expect(client.getQueryData(key)).toEqual(financeSummary());
  expect(
    client
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.status === 'success'),
  ).toHaveLength(1);
});

test('BARBER invokes Rules-of-Hooks path without any BF240 request or financial placeholder', async () => {
  agendaContext({ role: 'BARBER' });
  http.mockResolvedValue(response(financeSummary()));
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <HomeScreen />
    </QueryClientProvider>,
  );
  expect(screen.getByText('No hay próximos turnos')).toBeTruthy();
  expect(screen.getByText('Today operativo')).toBeTruthy();
  expect(screen.getByText('Stock operativo')).toBeTruthy();
  expect(http).not.toHaveBeenCalled();
  expect(screen.queryByText(/Indicadores no disponibles|Resumen financiero/)).toBeNull();
  expect(screen.queryByLabelText(/^Ingresos/)).toBeNull();
});

test('summary transport failure affects only financial widgets, not the whole Home', async () => {
  http.mockResolvedValue(response({ code: '42501', message: 'synthetic private error' }, 403));
  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <HomeScreen />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText('No pudimos cargar los indicadores.')).toBeTruthy());
  expect(screen.getByText('No pudimos cargar el resumen financiero.')).toBeTruthy();
  expect(screen.getByText('No hay próximos turnos')).toBeTruthy();
  expect(screen.getByText('Today operativo')).toBeTruthy();
  expect(screen.getByText('Stock operativo')).toBeTruthy();
  expect(screen.queryByText('synthetic private error')).toBeNull();
  expect(http).toHaveBeenCalledTimes(1);
});
