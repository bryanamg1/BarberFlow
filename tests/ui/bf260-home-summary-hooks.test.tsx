import { QueryClientProvider, notifyManager, defaultScheduler } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useHomeDashboardSummary } from '@/features/analytics/hooks/useHomeDashboardSummary';
import { analyticsService } from '@/features/analytics/services/analyticsService';
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
jest.mock('@/features/analytics/services/analyticsService', () => ({
  analyticsService: { getDashboardSummary: jest.fn(), getRevenueByDay: jest.fn() },
}));
const read = jest.mocked(analyticsService.getDashboardSummary);
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:00:00Z'));
  read.mockResolvedValue({ data: financeSummary(), error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

async function mount() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: true, staleTime: Infinity, gcTime: Infinity } });
  let current!: ReturnType<typeof useHomeDashboardSummary>;
  function Probe() {
    current = useHomeDashboardSummary();
    return null;
  }
  const element = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const view = await render(element());
  return {
    client,
    get result() {
      return current;
    },
    change: () => view.rerender(element()),
    unmount: () => view.unmount(),
  };
}

test.each(['logout', 'recovery', 'business', 'revalidating', 'BARBER', 'blur', 'invalid-zone'])(
  '%s never requests financial data',
  async (mode) => {
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (mode === 'recovery')
      jest
        .mocked(useAuth)
        .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
    if (mode === 'business')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
    if (mode === 'revalidating')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    if (mode === 'invalid-zone') agendaContext({ timezone: 'Invalid/Zone' });
    const h = await mount();
    expect(h.result.status).toBe('unavailable');
    expect(read).not.toHaveBeenCalled();
  },
);

test('OWNER uses only BF240, exact canonical key, explicit TODAY bounds and AbortSignal', async () => {
  const h = await mount();
  await waitFor(() => expect(h.result.status).toBe('success'));
  const range = { from: '2026-10-28T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z' };
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('b', range, expect.any(AbortSignal));
  expect(analyticsService.getRevenueByDay).not.toHaveBeenCalled();
  const query = h.client
    .getQueryCache()
    .getAll()
    .find((q) => q.state.status === 'success')!;
  expect(query.queryKey).toEqual(
    analyticsKeys.resource(
      'summary',
      { businessId: 'b', userId: 'u', membershipId: 'm', timezone: 'UTC' },
      range,
    ),
  );
  expect(query.options.retry).toBe(false);
  const invalidate = jest.spyOn(h.client, 'invalidateQueries');
  await h.change();
  expect(read).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
});

test.each([
  [
    '2026-03-08T12:00:00Z',
    'America/New_York',
    '2026-03-08T05:00:00.000Z',
    '2026-03-09T04:00:00.000Z',
  ],
  [
    '2026-11-01T12:00:00Z',
    'America/New_York',
    '2026-11-01T04:00:00.000Z',
    '2026-11-02T05:00:00.000Z',
  ],
  [
    '2026-10-29T01:00:00Z',
    'America/Argentina/Buenos_Aires',
    '2026-10-28T03:00:00.000Z',
    '2026-10-29T03:00:00.000Z',
  ],
])('business day/DST at %s uses %s', async (at, timezone, from, to) => {
  agendaContext({ timezone });
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(at));
  await mount();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(read.mock.calls[0][1]).toEqual({ from, to });
});

test.each(['user', 'business', 'membership', 'timezone'] as const)(
  '%s switch isolates keys and rejects late old data',
  async (mode) => {
    let resolve!: (r: Awaited<ReturnType<typeof read>>) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const h = await mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const oldSignal = read.mock.calls[0][2]!;
    const oldKey = h.client
      .getQueryCache()
      .getAll()
      .find((q) => q.state.fetchStatus === 'fetching')!.queryKey;
    agendaContext(
      mode === 'user'
        ? { userId: 'u2' }
        : mode === 'business'
          ? { businessId: 'b2' }
          : mode === 'membership'
            ? { membershipId: 'm2' }
            : { timezone: 'Asia/Tokyo' },
    );
    await h.change();
    await waitFor(() => expect(h.result.status).toBe('success'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(oldSignal.aborted).toBe(true);
    expect(
      h.client
        .getQueryCache()
        .getAll()
        .find((q) => q.state.status === 'success')!.queryKey,
    ).not.toEqual(oldKey);
    await act(async () =>
      resolve({ data: { ...financeSummary(), total_revenue: '987654.00' }, error: null }),
    );
    expect(JSON.stringify(h.result)).not.toContain('987654');
  },
);

test('no midnight polling; refocus recaptures TODAY, hides old data until new range succeeds', async () => {
  const h = await mount();
  await waitFor(() => expect(h.result.status).toBe('success'));
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T12:00:00Z'));
  await h.change();
  expect(read).toHaveBeenCalledTimes(1);
  jest.mocked(useIsFocused).mockReturnValue(false);
  await h.change();
  expect(h.result.status).toBe('unavailable');
  let resolve!: (r: Awaited<ReturnType<typeof read>>) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  jest.mocked(useIsFocused).mockReturnValue(true);
  await h.change();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(h.result.status).toBe('loading');
  expect(read.mock.calls[1][1]).toEqual({
    from: '2026-10-29T00:00:00.000Z',
    to: '2026-10-30T00:00:00.000Z',
  });
  await act(async () => resolve({ data: financeSummary(), error: null }));
  await waitFor(() => expect(h.result.status).toBe('success'));
});

test('same-day refocus shares the same cache without forced invalidation', async () => {
  const h = await mount();
  await waitFor(() => expect(h.result.status).toBe('success'));
  jest.mocked(useIsFocused).mockReturnValue(false);
  await h.change();
  jest.mocked(useIsFocused).mockReturnValue(true);
  await h.change();
  await waitFor(() => expect(h.result.status).toBe('success'));
  expect(read).toHaveBeenCalledTimes(1);
});

test.each(['logout', 'BARBER', 'unmount'])(
  '%s cancels the last observer and rejects old success',
  async (mode) => {
    let resolve!: (r: Awaited<ReturnType<typeof read>>) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const h = await mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const signal = read.mock.calls[0][2]!;
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'unmount') await h.unmount();
    else await h.change();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: financeSummary(), error: null }));
    if (mode !== 'unmount') expect(h.result.status).toBe('unavailable');
    expect(
      h.client
        .getQueryCache()
        .getAll()
        .some((q) => q.state.status === 'success'),
    ).toBe(false);
  },
);

test.each(['NETWORK_ERROR', 'INVALID_DATA'] as const)(
  '%s never becomes zero/success and has no retry',
  async (code) => {
    read.mockResolvedValue({ data: null, error: { code, message: 'Seguro' } });
    const h = await mount();
    await waitFor(() =>
      expect(h.result.status).toBe(code === 'INVALID_DATA' ? 'unavailable' : 'error'),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect('data' in h.result).toBe(false);
  },
);
