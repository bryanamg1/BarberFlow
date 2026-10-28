import * as RN from 'react-native';
import {
  QueryClientProvider,
  notifyManager,
  defaultScheduler,
  onlineManager,
} from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import FinanceRoute from '@/app/(app)/(tabs)/finances';
import { FinanceScreen } from '@/features/analytics/screens/FinanceScreen';
import { analyticsService } from '@/features/analytics/services/analyticsService';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
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
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK from screen');
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));
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
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  onlineManager.setOnline(true);
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width: 375, height: 800, scale: 1, fontScale: 1 });
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:00:00Z'));
  service.getDashboardSummary.mockResolvedValue({ data: financeSummary(), error: null });
  service.getRevenueByDay.mockResolvedValue({ data: financeRevenue(), error: null });
  service.getExpenseSummary.mockResolvedValue({ data: financeExpenses(), error: null });
  service.getTopServices.mockResolvedValue({ data: financeServices(), error: null });
  service.getTopProducts.mockResolvedValue({ data: financeProducts(), error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
async function mount() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: Infinity } });
  return render(
    <QueryClientProvider client={client}>
      <FinanceRoute />
    </QueryClientProvider>,
  );
}
const press = async (name: string) => fireEvent.press(screen.getByRole('button', { name }));
test('existing route is thin FinanceScreen adapter; TODAY/overview and exact title/filter/tabs/content order', async () => {
  expect(FinanceRoute).toBe(FinanceScreen);
  await mount();
  await waitFor(() => expect(screen.getByText('Ingresos por día')).toBeTruthy());
  expect(screen.getByRole('heading', { name: 'Finanzas' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hoy', selected: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Resumen', selected: true })).toBeTruthy();
  const tree = screen.container.queryAll(() => true);
  const find = (label: string) => tree.findIndex((n) => n.props.accessibilityLabel === label);
  expect(find('Período financiero')).toBeLessThan(find('Sección de Finanzas'));
  expect(screen.queryByRole('heading', { name: 'Productos' })).toBeNull();
  expect(service.getExpenseSummary).not.toHaveBeenCalled();
  expect(service.getTopServices).not.toHaveBeenCalled();
  expect(service.getTopProducts).not.toHaveBeenCalled();
});
test('all four tabs compose exact panels, preserve MONTH and never show hidden product/expense sections', async () => {
  await mount();
  await waitFor(() => expect(screen.getByText('Ingresos por día')).toBeTruthy());
  await press('Mes');
  await waitFor(() => expect(service.getDashboardSummary).toHaveBeenCalledTimes(2));
  await press('Servicios');
  await waitFor(() =>
    expect(screen.getByRole('group', { name: /Corte histórico.*Cantidad: 2/ })).toBeTruthy(),
  );
  expect(screen.queryByText('Ingresos por día')).toBeNull();
  expect(screen.queryByRole('group', { name: /Ingresos totales:/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Mes', selected: true })).toBeTruthy();
  await press('Productos');
  await waitFor(() =>
    expect(screen.getByRole('group', { name: /Producto: Cera histórica/ })).toBeTruthy(),
  );
  expect(screen.queryByRole('heading', { name: 'Gastos' })).toBeNull();
  expect(service.getExpenseSummary).not.toHaveBeenCalled();
  await press('Gastos');
  await waitFor(() =>
    expect(screen.getByRole('group', { name: /Gastos manuales: ARS\s10,00/ })).toBeTruthy(),
  );
  expect(screen.queryByRole('heading', { name: 'Productos' })).toBeNull();
  expect(screen.queryByRole('group', { name: /Producto: Cera/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Mes', selected: true })).toBeTruthy();
  await press('Todo el historial');
  await waitFor(() => expect(service.getExpenseSummary).toHaveBeenCalledTimes(2));
  expect(service.getExpenseSummary.mock.calls[1][1]).toEqual({ from: null, to: null });
  expect(screen.getByRole('button', { name: 'Gastos', selected: true })).toBeTruthy();
  expect(service.getTopProducts).toHaveBeenCalledTimes(1);
});
test.each(['summary', 'revenue'] as const)(
  'Overview %s failure isolated; controls usable',
  async (failed) => {
    const error = { code: 'NETWORK_ERROR' as const, message: 'Seguro' };
    if (failed === 'summary') service.getDashboardSummary.mockResolvedValue({ data: null, error });
    else service.getRevenueByDay.mockResolvedValue({ data: null, error });
    await mount();
    await waitFor(() =>
      expect(
        screen.getByText(
          failed === 'summary'
            ? 'No pudimos cargar el resumen financiero.'
            : 'No pudimos cargar los ingresos.',
        ),
      ).toBeTruthy(),
    );
    if (failed === 'summary') expect(screen.getByText('Ingresos por día')).toBeTruthy();
    else expect(screen.getByRole('group', { name: /Ingresos totales: ARS\s100,00/ })).toBeTruthy();
    await press('Servicios');
    await waitFor(() =>
      expect(screen.getByRole('group', { name: /Corte histórico/ })).toBeTruthy(),
    );
    await press('Año');
    expect(screen.getByRole('button', { name: 'Año', selected: true })).toBeTruthy();
  },
);
test.each([
  ['Servicios', 'getTopServices', 'No pudimos cargar los servicios.'],
  ['Productos', 'getTopProducts', 'No pudimos cargar los productos.'],
  ['Gastos', 'getExpenseSummary', 'No pudimos cargar los gastos.'],
] as const)('%s error stays in content and allows leaving tab', async (tab, method, message) => {
  service[method].mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Seguro' },
  });
  await mount();
  await press(tab);
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  await press('Mes');
  expect(screen.getByRole('button', { name: 'Mes', selected: true })).toBeTruthy();
  await press('Resumen');
  await waitFor(() => expect(screen.getByText('Ingresos por día')).toBeTruthy());
});
test('loading on new period hides old cards, keeps controls interactive and never substitutes chart []', async () => {
  await mount();
  await waitFor(() => expect(screen.getByText('Ingresos por día')).toBeTruthy());
  let resolve!: (value: Awaited<ReturnType<typeof analyticsService.getRevenueByDay>>) => void;
  service.getRevenueByDay.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await press('Año');
  expect(screen.getByText('Cargando ingresos…')).toBeTruthy();
  expect(screen.queryByText('Sin ingresos en este período')).toBeNull();
  expect(screen.getByRole('button', { name: 'Servicios' })).toBeTruthy();
  await act(async () => resolve({ data: financeRevenue(), error: null }));
  await waitFor(() => expect(screen.getByText('Ingresos por día')).toBeTruthy());
});
test.each(['BARBER', 'logout', 'recovering', 'business-pending', 'revalidating'] as const)(
  '%s guard has no Finance requests or filters',
  async (mode) => {
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
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
    await mount();
    expect(screen.getByText('Finanzas no disponibles')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hoy' })).toBeNull();
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  },
);
test.each([375, 768, 1440])(
  'vertical scroll/centered1200 and accessible controls at %s',
  async (width) => {
    jest
      .mocked(RN.useWindowDimensions)
      .mockReturnValue({ width, height: 900, scale: 1, fontScale: 2 });
    await mount();
    await waitFor(() => expect(screen.getByText('Ingresos por día')).toBeTruthy());
    expect(
      screen.container.queryAll((n) => RN.StyleSheet.flatten(n.props.style)?.maxWidth === 1200)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('Período financiero')).toBeTruthy();
    expect(screen.getByLabelText('Sección de Finanzas')).toBeTruthy();
  },
);
