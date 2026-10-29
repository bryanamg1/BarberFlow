import { fireEvent, screen } from '@testing-library/react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { HomeStockScreen } from '@/features/analytics/screens/HomeStockScreen';
import { useLowStockAlerts } from '@/features/inventory/hooks/useLowStockAlerts';
import type { UseLowStockAlertsResult } from '@/features/inventory/types/lowStockAlerts.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/inventory/hooks/useLowStockAlerts', () => ({ useLowStockAlerts: jest.fn() }));
jest.mock('@/features/inventory/services/inventoryService', () => {
  throw new Error('Home imported stock service');
});
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Home imported Supabase');
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const hook = jest.mocked(useLowStockAlerts),
  authMock = jest.mocked(useAuth),
  businessMock = jest.mocked(useBusiness);
const business = (id = 'a', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const rows = [
  { product_id: 'p', name: 'Cera mate', minimum_stock: 3, current_stock: '3' },
  { product_id: 'q', name: 'Peine', minimum_stock: 4, current_stock: '0' },
];
const retry = jest.fn<Promise<void>, []>(async () => {});
const success = (items = rows, page = 1, hasNextPage = false): UseLowStockAlertsResult => ({
  status: 'success',
  data: { items, page, pageSize: 25, hasNextPage },
  error: null,
  isFetching: false,
  retry,
});
beforeEach(() => {
  resetRouterMocks();
  retry.mockClear();
  authMock.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u' },
    session: {},
    error: null,
  } as ReturnType<typeof useAuth>);
  businessMock.mockReturnValue(business());
  hook.mockReturnValue(success());
});
// BF265 owns the current route; keep BF263 isolated on its unchanged stock-only producer.
test('isolated Home stock screen consumes BF225 producer and shared badge/list without data-layer imports', async () => {
  await renderWithProviders(<HomeStockScreen />);
  expect(hook).toHaveBeenCalledWith(1);
  expect(screen.getByRole('heading', { name: 'Inicio' })).toBeOnTheScreen();
  expect(screen.getByRole('heading', { name: 'Stock bajo' })).toBeOnTheScreen();
  expect(screen.getByText('Cera mate')).toBeOnTheScreen();
  expect(screen.getByText('Stock: 3')).toBeOnTheScreen();
  expect(screen.getByText('Sin stock')).toBeOnTheScreen();
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s may navigate to Products without adjustment action',
  async (role) => {
    businessMock.mockReturnValue(business('a', role));
    await renderWithProviders(<HomeStockScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver productos' }));
    expect(routerMock.push).toHaveBeenCalledWith('/products');
    expect(screen.queryByRole('button', { name: 'Ajustar stock' })).toBeNull();
  },
);
test('empty success is explicit without pretending to know the global count', async () => {
  hook.mockReturnValue(success([]));
  await renderWithProviders(<HomeStockScreen />);
  expect(screen.getByText('No hay productos con stock bajo')).toBeOnTheScreen();
  expect(screen.queryByText('Stock: 0')).toBeNull();
});
test('one alert preserves huge integer stock string without local filtering', async () => {
  hook.mockReturnValue(success([{ ...rows[0], current_stock: '9007199254740993' }]));
  await renderWithProviders(<HomeStockScreen />);
  expect(screen.getByText('Stock: 9007199254740993')).toBeOnTheScreen();
  expect(screen.queryByText('Peine')).toBeNull();
});
test.each(['pending', 'disabled', 'idle'] as const)(
  '%s displays its own state, not zero alerts',
  async (status) => {
    hook.mockReturnValue({ status, data: null, error: null, isFetching: false, retry });
    await renderWithProviders(<HomeStockScreen />);
    expect(
      screen.getByText(
        status === 'pending'
          ? 'Cargando avisos de stock…'
          : status === 'disabled'
            ? 'Avisos de stock desactivados'
            : 'Negocio no disponible',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText('No hay productos con stock bajo')).toBeNull();
  },
);
test('independent section error retries via producer and preserves Home heading/navigation', async () => {
  hook.mockReturnValue({
    status: 'error',
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
    isFetching: false,
    retry,
  });
  await renderWithProviders(<HomeStockScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Inicio' })).toBeOnTheScreen();
  expect(screen.queryByText('Cera mate')).toBeNull();
});
test('pagination uses producer params and resets to page one after business switch', async () => {
  hook.mockImplementation((page) => success(rows, page, true));
  const view = await renderWithProviders(<HomeStockScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
  expect(hook).toHaveBeenLastCalledWith(2);
  businessMock.mockReturnValue(business('b'));
  await view.rerender(<HomeStockScreen />);
  expect(hook).toHaveBeenLastCalledWith(1);
});
test('actor change also resets paging, using the hook for data isolation', async () => {
  hook.mockImplementation((page) => success(rows, page, true));
  const view = await renderWithProviders(<HomeStockScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
  authMock.mockReturnValue({
    status: 'authenticated',
    user: { id: 'new-user' },
    session: {},
    error: null,
  } as ReturnType<typeof useAuth>);
  await view.rerender(<HomeStockScreen />);
  expect(hook).toHaveBeenLastCalledWith(1);
});
