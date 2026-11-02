import { QueryClientProvider, defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { FinanceScreen } from '@/features/analytics/screens/FinanceScreen';
import { analyticsService } from '@/features/analytics/services/analyticsService';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { theme } from '@/theme';
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
    useIsFocused: () => true,
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});
jest.mock('@/features/analytics/services/analyticsService', () => ({
  analyticsService: {
    getDashboardSummary: jest.fn(),
    getRevenueByDay: jest.fn(),
    getTopServices: jest.fn(),
    getTopProducts: jest.fn(),
    getExpenseSummary: jest.fn(),
  },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK from desktop Finance');
});
const service = jest.mocked(analyticsService),
  original = Dimensions.get('window');
const widths = [320, 390, 767, 768, 1024, 1200, 1280];
const resize = async (width: number) =>
  act(() => Dimensions.set({ window: { ...original, width } }));
const metricLabels = [
  'Ingresos totales',
  'Ingresos por servicios',
  'Ingresos por productos',
  'Gastos manuales',
  'Compras de mercadería',
  'Ganancia',
  'Turnos',
  'Clientes activos',
  'Ticket promedio',
  'Productos vendidos',
  'Cancelaciones',
  'Ausencias',
];
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:00:00Z'));
  service.getDashboardSummary.mockResolvedValue({ data: financeSummary(), error: null });
  service.getRevenueByDay.mockResolvedValue({ data: financeRevenue(), error: null });
  service.getTopServices.mockResolvedValue({ data: financeServices(), error: null });
  service.getTopProducts.mockResolvedValue({ data: financeProducts(), error: null });
  service.getExpenseSummary.mockResolvedValue({ data: financeExpenses(), error: null });
});
afterEach(async () => {
  notifyManager.setScheduler(defaultScheduler);
  await resize(original.width);
});
async function mount() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: Infinity } });
  return render(
    <QueryClientProvider client={client}>
      <FinanceScreen />
    </QueryClientProvider>,
  );
}
function ancestor(start: TestInstance, predicate: (style: ViewStyle | undefined) => boolean) {
  let node: TestInstance | null = start;
  while (node) {
    if (predicate(StyleSheet.flatten(node.props.style))) return node;
    node = node.parent;
  }
  throw new Error('Missing responsive Finance container');
}
const counts = () => Object.values(service).map((fn) => jest.mocked(fn).mock.calls.length);
const press = async (name: string) => fireEvent.press(screen.getByRole('button', { name }));

test.each(widths)(
  'width %s keeps all12 KPIs, chart, lazy tabs and one query per active resource',
  async (width) => {
    await resize(width);
    await mount();
    await screen.findByText('Ingresos por día');
    const content = ancestor(
      screen.getByRole('heading', { name: 'Finanzas' }),
      (s) => s?.width === '100%',
    );
    expect(StyleSheet.flatten(content.props.style)).toMatchObject({
      paddingHorizontal: theme.spacing[16],
      paddingVertical: theme.spacing[16],
      gap: theme.spacing[24],
      maxWidth: width >= 768 ? 1200 : undefined,
    });
    expect(screen.getByRole('button', { name: 'Hoy', selected: true })).toBeTruthy();
    const metrics = screen
      .getAllByRole('group')
      .filter((n) =>
        metricLabels.some((label) => n.props.accessibilityLabel?.startsWith(label + ':')),
      );
    expect(metrics.map((n) => n.props.accessibilityLabel.split(':')[0])).toEqual(metricLabels);
    const card = screen.getByLabelText('Turnos: 2');
    expect(StyleSheet.flatten(card.props.style).flexBasis).toBe(width >= 768 ? '40%' : undefined);
    expect(service.getDashboardSummary).toHaveBeenCalledTimes(1);
    expect(service.getRevenueByDay).toHaveBeenCalledTimes(1);
    expect(service.getTopServices).not.toHaveBeenCalled();
    expect(service.getTopProducts).not.toHaveBeenCalled();
    expect(service.getExpenseSummary).not.toHaveBeenCalled();
    const before = counts();
    for (const nextWidth of [width >= 768 ? 390 : 1280, width]) {
      await resize(nextWidth);
      expect(counts()).toEqual(before);
      expect(screen.getByRole('button', { name: 'Resumen', selected: true })).toBeTruthy();
      expect(screen.getByText('Ingresos por día')).toBeTruthy();
    }
    await press('Servicios');
    await screen.findByRole('group', { name: /Corte histórico.*Cantidad: 2/ });
    expect(service.getTopServices).toHaveBeenCalledTimes(1);
    expect(service.getTopProducts).not.toHaveBeenCalled();
    expect(service.getExpenseSummary).not.toHaveBeenCalled();
    await press('Productos');
    await screen.findByRole('group', { name: /Producto: Cera histórica/ });
    expect(service.getTopProducts).toHaveBeenCalledTimes(1);
    expect(service.getExpenseSummary).not.toHaveBeenCalled();
    await press('Gastos');
    await screen.findByRole('group', { name: /Gastos manuales: ARS\s10,00/ });
    expect(service.getExpenseSummary).toHaveBeenCalledTimes(1);
    const final = counts();
    await resize(width >= 768 ? 390 : 1280);
    expect(screen.getByRole('button', { name: 'Gastos', selected: true })).toBeTruthy();
    expect(counts()).toEqual(final);
  },
);

test.each(['Hoy', 'Semana', 'Mes', 'Año', 'Todo el historial'])(
  'period %s and active tab survive actual dimension events',
  async (period) => {
    await resize(390);
    await mount();
    await screen.findByText('Ingresos por día');
    await press(period);
    await waitFor(() =>
      expect(screen.getByRole('group', { name: /^Ingresos totales:/ })).toBeTruthy(),
    );
    await press('Servicios');
    await screen.findByRole('group', { name: /Corte histórico/ });
    const before = counts();
    await resize(1280);
    expect(screen.getByRole('button', { name: period, selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Servicios', selected: true })).toBeTruthy();
    expect(counts()).toEqual(before);
    if (period === 'Todo el historial')
      expect(service.getTopServices.mock.calls.at(-1)![1]).toEqual({ from: null, to: null });
  },
);

test.each(widths)('BARBER width %s never starts financial reads', async (width) => {
  agendaContext({ role: 'BARBER' });
  await resize(width);
  await mount();
  expect(screen.getByText('Finanzas no disponibles')).toBeTruthy();
  expect(counts()).toEqual([0, 0, 0, 0, 0]);
  expect(screen.queryByText('Ingresos por día')).toBeNull();
});
