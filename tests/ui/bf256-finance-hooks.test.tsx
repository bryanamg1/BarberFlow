import {
  QueryClientProvider,
  notifyManager,
  defaultScheduler,
  onlineManager,
} from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useFinanceQueries } from '@/features/analytics/hooks/useFinanceQueries';
import { analyticsService } from '@/features/analytics/services/analyticsService';
import type { FinanceTab } from '@/features/analytics/components/FinanceTabs';
import type { FinancePeriod } from '@/features/analytics/utils/financePeriod';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { agendaContext } from './helpers/agendaFixture';
import {
  financeSummary,
  financeRevenue,
  financeServices,
  financeProducts,
  financeExpenses,
} from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useIsFocused: jest.fn(),
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});
jest.mock('@/features/analytics/services/analyticsService', () => ({
  analyticsService: {
    getDashboardSummary: jest.fn(),
    getRevenueByDay: jest.fn(),
    getExpenseSummary: jest.fn(),
    getTopServices: jest.fn(),
    getTopProducts: jest.fn(),
  },
}));
const service = jest.mocked(analyticsService);
const methods = [
  'getDashboardSummary',
  'getRevenueByDay',
  'getExpenseSummary',
  'getTopServices',
  'getTopProducts',
] as const;
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  onlineManager.setOnline(true);
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:00:00Z'));
  service.getDashboardSummary.mockResolvedValue({ data: financeSummary(), error: null });
  service.getRevenueByDay.mockResolvedValue({ data: financeRevenue(), error: null });
  service.getExpenseSummary.mockResolvedValue({ data: financeExpenses(), error: null });
  service.getTopServices.mockResolvedValue({ data: financeServices(), error: null });
  service.getTopProducts.mockResolvedValue({ data: financeProducts(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
});
async function mount(tab: FinanceTab = 'overview', period: FinancePeriod = 'TODAY') {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity } });
  let current!: ReturnType<typeof useFinanceQueries>;
  function Probe() {
    current = useFinanceQueries(tab, period);
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
    async change(nextTab = tab, nextPeriod = period) {
      tab = nextTab;
      period = nextPeriod;
      await view.rerender(element());
    },
    unmount: () => view.unmount(),
  };
}
test.each([
  ['overview', ['getDashboardSummary', 'getRevenueByDay']],
  ['services', ['getTopServices']],
  ['products', ['getTopProducts']],
  ['expenses', ['getExpenseSummary']],
] as const)('TAB-AWARE %s starts only its source(s), no eager/prefetch', async (tab, expected) => {
  const h = await mount(tab);
  await waitFor(() =>
    expect(expected.every((name) => service[name].mock.calls.length === 1)).toBe(true),
  );
  for (const method of methods)
    expect(service[method]).toHaveBeenCalledTimes(
      (expected as readonly string[]).includes(method) ? 1 : 0,
    );
  if (tab === 'overview') await waitFor(() => expect(h.result.kpis.status).toBe('success'));
  if (tab === 'products')
    expect(service.getTopProducts).toHaveBeenCalledWith(
      'b',
      { from: '2026-10-28T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z' },
      10,
      expect.any(AbortSignal),
    );
});
test.each(['TODAY', 'WEEK', 'MONTH', 'YEAR', 'ALL_TIME'] as const)(
  'period %s requests only active Services with valid bounds and p_limit10',
  async (period) => {
    await mount('services', period);
    await waitFor(() => expect(service.getTopServices).toHaveBeenCalledTimes(1));
    const args = service.getTopServices.mock.calls[0];
    expect(args[2]).toBe(10);
    if (period === 'ALL_TIME') expect(args[1]).toEqual({ from: null, to: null });
    else {
      expect(Date.parse(args[1].from!)).toBeLessThan(Date.parse(args[1].to!));
    }
    for (const m of methods.filter((n) => n !== 'getTopServices'))
      expect(service[m]).not.toHaveBeenCalled();
  },
);
test('period change preserves tab, hides old completed data and never fetches inactive tabs', async () => {
  const h = await mount('products');
  await waitFor(() => expect(h.result.products.status).toBe('success'));
  let resolve!: (value: Awaited<ReturnType<typeof analyticsService.getTopProducts>>) => void;
  service.getTopProducts.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await h.change('products', 'MONTH');
  expect(h.result.products.status).toBe('loading');
  await waitFor(() => expect(service.getTopProducts).toHaveBeenCalledTimes(2));
  expect(service.getTopProducts.mock.calls[1][1]).not.toEqual(
    service.getTopProducts.mock.calls[0][1],
  );
  for (const m of methods.filter((n) => n !== 'getTopProducts'))
    expect(service[m]).not.toHaveBeenCalled();
  await act(async () => resolve({ data: financeProducts(), error: null }));
  await waitFor(() => expect(h.result.products.status).toBe('success'));
});
test('tab change retains MONTH, cached exact context returns without forced refetch/invalidation', async () => {
  const h = await mount('services', 'MONTH');
  await waitFor(() => expect(h.result.services.status).toBe('success'));
  const bounds = service.getTopServices.mock.calls[0][1];
  const invalidate = jest.spyOn(h.client, 'invalidateQueries');
  await h.change('expenses');
  await waitFor(() => expect(h.result.expenses.status).toBe('success'));
  expect(service.getExpenseSummary.mock.calls[0][1]).toEqual(bounds);
  expect(h.result.services.status).toBe('unavailable');
  await h.change('services');
  expect(h.result.services.status).toBe('success');
  expect(service.getTopServices).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
});
test.each(['BARBER', 'logout', 'recovering', 'business-pending', 'revalidating', 'blur'] as const)(
  'no requests for %s',
  async (mode) => {
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (mode === 'recovering')
      jest
        .mocked(useAuth)
        .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
    if (mode === 'business-pending')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
    if (mode === 'revalidating')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
    if (mode === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    const h = await mount();
    expect(h.result.available).toBe(false);
    for (const m of methods) expect(service[m]).not.toHaveBeenCalled();
  },
);
test('late A response cannot populate current B presentation; signals cancelled on context change/unmount', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof analyticsService.getTopServices>>) => void;
  service.getTopServices.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const h = await mount('services');
  await waitFor(() => expect(service.getTopServices).toHaveBeenCalledTimes(1));
  const oldSignal = service.getTopServices.mock.calls[0][3]!;
  agendaContext({ businessId: 'business-B' });
  await h.change();
  await waitFor(() => expect(service.getTopServices).toHaveBeenCalledTimes(2));
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(h.result.services.status).toBe('success'));
  await act(async () =>
    resolve({ data: [{ ...financeServices()[0], name: 'OLD A' }], error: null }),
  );
  expect(JSON.stringify(h.result.services)).not.toContain('OLD A');
  expect(service.getTopServices.mock.calls[1][0]).toBe('business-B');
  service.getTopServices.mockImplementationOnce(() => new Promise(() => {}));
  await h.change('services', 'MONTH');
  await waitFor(() => expect(service.getTopServices).toHaveBeenCalledTimes(3));
  const pendingSignal = service.getTopServices.mock.calls[2][3]!;
  await h.unmount();
  expect(pendingSignal.aborted).toBe(true);
});
test('Overview summary and revenue errors are independent; INVALID_DATA is unavailable', async () => {
  service.getRevenueByDay.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Seguro' },
  });
  const h = await mount();
  await waitFor(() => expect(h.result.kpis.status).toBe('success'));
  await waitFor(() => expect(h.result.revenue.status).toBe('error'));
  service.getTopServices.mockResolvedValue({
    data: null,
    error: { code: 'INVALID_DATA', message: 'Seguro' },
  });
  await h.change('services');
  await waitFor(() => expect(h.result.services.status).toBe('unavailable'));
});
test('business timezone changes keys and bounds; no same-business wrong-zone cache', async () => {
  const h = await mount('services');
  await waitFor(() => expect(h.result.services.status).toBe('success'));
  const oldBounds = service.getTopServices.mock.calls[0][1];
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  await h.change();
  await waitFor(() => expect(service.getTopServices).toHaveBeenCalledTimes(2));
  expect(service.getTopServices.mock.calls[1][1]).not.toEqual(oldBounds);
});

test('TODAY bounds refresh when a new tab opens after business midnight without polling', async () => {
  const h = await mount('services');
  await waitFor(() => expect(h.result.services.status).toBe('success'));
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T12:00:00Z'));
  await h.change('expenses');
  await waitFor(() => expect(service.getExpenseSummary).toHaveBeenCalledTimes(1));
  expect(service.getExpenseSummary.mock.calls[0][1].from).toBe('2026-10-29T00:00:00.000Z');
});
