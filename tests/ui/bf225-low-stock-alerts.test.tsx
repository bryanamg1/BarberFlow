import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { businessSettingsKey } from '@/features/business/hooks/useBusinessSettings';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import { LowStockAlertList } from '@/features/inventory/components/LowStockAlertList';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { useLowStockAlerts } from '@/features/inventory/hooks/useLowStockAlerts';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import type {
  LowStockPage,
  UseLowStockAlertsResult,
} from '@/features/inventory/types/lowStockAlerts.types';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: { get: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getLowStockProducts: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Alert UI imported Supabase');
});
const b = '00000000-0000-4000-8000-000000000225',
  other = '00000000-0000-4000-8000-000000000263';
const authMock = jest.mocked(useAuth),
  businessMock = jest.mocked(useBusiness),
  settings = jest.mocked(businessSettingsService),
  service = jest.mocked(inventoryService);
const business = (id = b, role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const auth = (id = 'actor') =>
  ({ status: 'authenticated', user: { id }, session: {}, error: null }) as ReturnType<
    typeof useAuth
  >;
const preferences = (id = b, enabled = true) =>
  ({
    data: {
      profile: {
        id,
        name: 'Demo',
        phone: null,
        email: null,
        address: null,
        currency_code: 'ARS',
        timezone: 'UTC',
      },
      preferences: {
        business_id: id,
        appointment_interval_minutes: 30,
        default_service_buffer_minutes: 0,
        allow_overlapping_appointments: false,
        low_stock_notifications: enabled,
      },
    },
    error: null,
  }) as const;
const rows = [
  { product_id: 'p', name: 'Cera', current_stock: '3', minimum_stock: 3 },
  { product_id: 'q', name: 'Peine', current_stock: '0', minimum_stock: 0 },
];
const page = (items = rows, number = 1, hasNextPage = false): LowStockPage => ({
  items,
  page: number,
  pageSize: 25,
  hasNextPage,
});
let latest: UseLowStockAlertsResult;
function Probe({ number = 1, size = 25 }: { number?: number; size?: number }) {
  latest = useLowStockAlerts(number, size);
  return (
    <>
      <Text>{latest.status}</Text>
      <LowStockAlertList result={latest} onPrevious={() => {}} onNext={() => {}} />
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  authMock.mockReturnValue(auth());
  businessMock.mockReturnValue(business());
  settings.get.mockImplementation(async (id) => preferences(id));
  service.getLowStockProducts.mockResolvedValue({ data: page(), error: null });
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s reads persisted preference and server alert list',
  async (role) => {
    businessMock.mockReturnValue(business(b, role));
    await renderWithProviders(<Probe />);
    await screen.findByText('Cera');
    expect(latest.status).toBe('success');
    expect(settings.get).toHaveBeenCalledWith(b);
    expect(service.getLowStockProducts).toHaveBeenCalledWith(b, { page: 1, pageSize: 25 });
    expect(screen.getByText('Stock: 3')).toBeOnTheScreen();
    expect(screen.getByText('Sin stock')).toBeOnTheScreen();
  },
);
test('OFF is explicit disabled and never queries low-stock RPC', async () => {
  settings.get.mockResolvedValue(preferences(b, false));
  await renderWithProviders(<Probe />);
  await screen.findByText('Avisos de stock desactivados');
  expect(latest.status).toBe('disabled');
  expect(service.getLowStockProducts).not.toHaveBeenCalled();
});
test('empty success differs from disabled/error', async () => {
  service.getLowStockProducts.mockResolvedValue({ data: page([]), error: null });
  await renderWithProviders(<Probe />);
  await screen.findByText('No hay productos con stock bajo');
  expect(latest.status).toBe('success');
});
test('invalid configuration never defaults to ON/OFF or requests alerts', async () => {
  const invalid = preferences();
  settings.get.mockResolvedValue({
    ...invalid,
    data: {
      ...invalid.data,
      preferences: { ...invalid.data.preferences, low_stock_notifications: undefined },
    },
  } as unknown as Awaited<ReturnType<typeof businessSettingsService.get>>);
  await renderWithProviders(<Probe />);
  await waitFor(() => expect(latest.status).toBe('error'));
  expect(service.getLowStockProducts).not.toHaveBeenCalled();
  expect(screen.queryByText('Avisos de stock desactivados')).toBeNull();
});
test('preference loading does not assume ON or OFF or load stock', async () => {
  settings.get.mockReturnValue(new Promise(() => {}));
  await renderWithProviders(<Probe />);
  expect(screen.getByText('Cargando avisos de stock…')).toBeOnTheScreen();
  expect(service.getLowStockProducts).not.toHaveBeenCalled();
});
test('missing configuration surfaces safe error with explicit retry, never empty success', async () => {
  settings.get.mockResolvedValueOnce({
    data: null,
    error: { code: 'SETTINGS_NOT_FOUND', message: 'Configuración no disponible' },
  });
  await renderWithProviders(<Probe />);
  await screen.findByText('Configuración no disponible');
  expect(service.getLowStockProducts).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Cera');
});
test('alert failure hides stale data and explicit retry recovers without automatic retry', async () => {
  service.getLowStockProducts.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
  });
  await renderWithProviders(<Probe />);
  await screen.findByText('Sin conexión');
  expect(service.getLowStockProducts).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Cera')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Cera');
});
test.each(['unauthenticated', 'recovering', 'initializing'] as const)(
  '%s prevents settings and stock reads',
  async (status) => {
    authMock.mockReturnValue({ ...auth(), status } as ReturnType<typeof useAuth>);
    await renderWithProviders(<Probe />);
    expect(latest.status).toBe('idle');
    expect(settings.get).not.toHaveBeenCalled();
    expect(service.getLowStockProducts).not.toHaveBeenCalled();
  },
);
test('late old-business response never appears after business switch', async () => {
  const pending = deferred<Awaited<ReturnType<typeof inventoryService.getLowStockProducts>>>();
  service.getLowStockProducts.mockImplementation((id) =>
    id === b
      ? pending.promise
      : Promise.resolve({ data: page([{ ...rows[0], name: 'Nuevo negocio' }]), error: null }),
  );
  const view = await renderWithProviders(<Probe />);
  await waitFor(() => expect(service.getLowStockProducts).toHaveBeenCalledTimes(1));
  businessMock.mockReturnValue(business(other));
  await view.rerender(<Probe />);
  await screen.findByText('Nuevo negocio');
  await act(async () => pending.resolve({ data: page(), error: null }));
  expect(screen.queryByText('Cera')).toBeNull();
  expect(latest.status).toBe('success');
});
test('logout hides already loaded alerts and cached data cannot leak to a new actor', async () => {
  const view = await renderWithProviders(<Probe />);
  await screen.findByText('Cera');
  authMock.mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  await view.rerender(<Probe />);
  expect(screen.queryByText('Cera')).toBeNull();
  expect(latest.status).toBe('idle');
  authMock.mockReturnValue(auth('new-actor'));
  service.getLowStockProducts.mockReturnValue(new Promise(() => {}));
  await view.rerender(<Probe />);
  await screen.findByText('Cargando avisos de stock…');
  expect(screen.queryByText('Cera')).toBeNull();
});
test('BF224 captured-business invalidation refreshes alerts using same inventory prefix', async () => {
  const view = await renderWithProviders(<Probe />);
  await screen.findByText('Cera');
  service.getLowStockProducts.mockResolvedValue({ data: page([]), error: null });
  await act(async () => {
    await view.queryClient.invalidateQueries({ queryKey: inventoryKeys.byBusiness(b) });
  });
  await screen.findByText('No hay productos con stock bajo');
  expect(service.getLowStockProducts).toHaveBeenCalledTimes(2);
});
test('BF275 shared preference cache update immediately disables loaded alerts', async () => {
  const view = await renderWithProviders(<Probe />);
  await screen.findByText('Cera');
  await act(async () => {
    view.queryClient.setQueryData(
      businessSettingsKey({ businessId: b, membershipId: 'm-' + b, userId: 'actor' }),
      preferences(b, false).data,
    );
  });
  await screen.findByText('Avisos de stock desactivados');
  expect(screen.queryByText('Cera')).toBeNull();
  expect(service.getLowStockProducts).toHaveBeenCalledTimes(1);
});
test('page dimensions isolate queries, bigint strings and server rows are not recalculated/filtered', async () => {
  service.getLowStockProducts.mockResolvedValue({
    data: page([{ ...rows[0], current_stock: '9007199254740993' }], 2, true),
    error: null,
  });
  await renderWithProviders(<Probe number={2} />);
  await screen.findByText('Stock: 9007199254740993');
  expect(service.getLowStockProducts).toHaveBeenCalledWith(b, { page: 2, pageSize: 25 });
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
});
test('invalid page stops reads and no default is silently substituted', async () => {
  await renderWithProviders(<Probe number={0} />);
  expect(latest.status).toBe('error');
  expect(settings.get).not.toHaveBeenCalled();
  expect(service.getLowStockProducts).not.toHaveBeenCalled();
});
