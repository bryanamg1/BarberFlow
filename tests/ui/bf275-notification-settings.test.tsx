import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import NotificationRoute from '@/app/(app)/settings/notifications';
import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { businessSettingsKey } from '@/features/business/hooks/useBusinessSettings';
import type { BusinessSettings } from '@/features/business/repositories/businessSettingsRepository';
import { NotificationSettingsScreen } from '@/features/business/screens/NotificationSettingsScreen';
import { SettingsScreen } from '@/features/business/screens/SettingsScreen';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import { businessPreferencesSchema } from '@/features/business/schemas/businessSettings.schema';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: {
    get: jest.fn(),
    updatePreferences: jest.fn(),
    updateProfile: jest.fn(),
  },
  settingsError: (code: string) => ({ code, message: 'Acceso denegado.' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({
  router: {
    ...jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
    canGoBack: jest.fn(),
  },
}));
const businessMock = jest.mocked(useBusiness),
  authMock = jest.mocked(useAuth),
  service = jest.mocked(businessSettingsService);
const canGoBack = jest.requireMock<{ router: { canGoBack: jest.Mock } }>('expo-router').router
  .canGoBack;
const business = (id = 'a', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const auth = (id = 'u') =>
  ({ status: 'authenticated', session: {}, user: { id }, error: null }) as AuthState;
const stored = new Map<string, boolean>();
const preferences = (id = 'a'): BusinessSettings => ({
  business_id: id,
  appointment_interval_minutes: 30,
  default_service_buffer_minutes: 0,
  allow_overlapping_appointments: false,
  low_stock_notifications: stored.get(id) ?? true,
});
const profile = (id = 'a') => ({
  id,
  name: 'Demo',
  phone: null,
  email: null,
  address: null,
  currency_code: 'ARS',
  timezone: 'UTC',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const ready = (value = true) =>
  waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Avisos de stock bajo: ' + (value ? 'Sí' : 'No') }),
    ).toBeOnTheScreen(),
  );
beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  stored.clear();
  stored.set('a', true);
  stored.set('b', false);
  businessMock.mockReturnValue(business());
  authMock.mockReturnValue(auth());
  canGoBack.mockReturnValue(false);
  service.get.mockImplementation(async (id) => ({
    data: { profile: profile(id), preferences: preferences(id) },
    error: null,
  }));
  service.updatePreferences.mockImplementation(async (id, input) => {
    if (input.low_stock_notifications !== undefined) stored.set(id, input.low_stock_notifications);
    return { data: preferences(id), error: null };
  });
});
test('BF275 route exports only NotificationSettingsScreen', () => {
  expect(NotificationRoute).toBe(NotificationSettingsScreen);
});
test.each([true, false])(
  'BF275 loads persisted %s with no fabricated default or write',
  async (value) => {
    stored.set('a', value);
    await renderWithProviders(<NotificationRoute />);
    await ready(value);
    expect(service.get).toHaveBeenCalledWith('a');
    expect(service.updatePreferences).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Guardar notificaciones' })).toBeDisabled();
    expect(screen.getByText(/avisos de stock bajo dentro de la aplicación/)).toBeOnTheScreen();
  },
);
test('BF275 writes only the dirty boolean and refreshes the shared scoped settings cache', async () => {
  const view = await renderWithProviders(<NotificationRoute />);
  await ready();
  const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  await waitFor(() => expect(screen.getByText('Preferencia guardada.')).toBeOnTheScreen());
  expect(service.updatePreferences).toHaveBeenCalledTimes(1);
  expect(service.updatePreferences).toHaveBeenCalledWith('a', { low_stock_notifications: false });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: businessSettingsKey({ businessId: 'a', membershipId: 'm-a', userId: 'u' }),
    exact: true,
  });
  expect(
    view.queryClient.getQueryData<{ preferences: BusinessSettings }>(
      businessSettingsKey({ businessId: 'a', membershipId: 'm-a', userId: 'u' }),
    )?.preferences.low_stock_notifications,
  ).toBe(false);
  expect(service.updateProfile).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Guardar notificaciones' })).toBeDisabled();
  await ready(false);
});
test('BF275 adopts the returned persisted boolean rather than assuming the submitted value', async () => {
  service.updatePreferences.mockResolvedValueOnce({ data: preferences(), error: null });
  await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  await waitFor(() => expect(screen.getByText('Preferencia guardada.')).toBeOnTheScreen());
  await ready(true);
});
test('BF275 pending submit disables editing and rejects duplicate presses', async () => {
  const pending = deferred<Awaited<ReturnType<typeof businessSettingsService.updatePreferences>>>();
  service.updatePreferences.mockReturnValueOnce(pending.promise);
  await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  await press('Guardar notificaciones');
  expect(service.updatePreferences).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Avisos de stock bajo: No' })).toBeDisabled();
  await act(async () => {
    stored.set('a', false);
    pending.resolve({ data: preferences(), error: null });
  });
});
test('BF275 normalized failure preserves draft and permits explicit retry without hidden automatic retry', async () => {
  service.updatePreferences.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' },
  });
  await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión.'));
  await ready(false);
  expect(service.updatePreferences).toHaveBeenCalledTimes(1);
  await press('Guardar notificaciones');
  await waitFor(() => expect(screen.getByText('Preferencia guardada.')).toBeOnTheScreen());
  expect(service.updatePreferences).toHaveBeenCalledTimes(2);
});
test('BF275 BARBER direct route is restricted and makes no configuration request or mutation', async () => {
  businessMock.mockReturnValue(business('a', 'BARBER'));
  await renderWithProviders(<NotificationRoute />);
  expect(screen.getByText('Acceso restringido')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Guardar notificaciones' })).toBeNull();
  expect(service.get).not.toHaveBeenCalled();
  expect(service.updatePreferences).not.toHaveBeenCalled();
});
test('BF275 loading is distinct from a default true preference', async () => {
  const pending = deferred<Awaited<ReturnType<typeof businessSettingsService.get>>>();
  service.get.mockReturnValueOnce(pending.promise);
  await renderWithProviders(<NotificationRoute />);
  expect(screen.getByRole('progressbar', { name: 'Cargando preferencias…' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Guardar notificaciones' })).toBeNull();
  await act(async () =>
    pending.resolve({ data: { profile: profile(), preferences: preferences() }, error: null }),
  );
  await ready();
});
test('BF275 missing configuration stays an error without a manufactured preference', async () => {
  service.get.mockResolvedValueOnce({
    data: null,
    error: { code: 'SETTINGS_NOT_FOUND', message: 'La configuración no está disponible.' },
  });
  await renderWithProviders(<NotificationRoute />);
  await waitFor(() =>
    expect(screen.getByText('La configuración no está disponible.')).toBeOnTheScreen(),
  );
  expect(screen.queryByRole('button', { name: 'Guardar notificaciones' })).toBeNull();
  await press('Reintentar');
  await ready();
});
test('BF275 query refresh preserves a dirty local choice', async () => {
  const view = await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await act(async () => {
    await view.queryClient.invalidateQueries({
      queryKey: businessSettingsKey({ businessId: 'a', membershipId: 'm-a', userId: 'u' }),
      exact: true,
    });
  });
  await ready(false);
  expect(screen.getByRole('button', { name: 'Guardar notificaciones' })).toBeEnabled();
  expect(service.updatePreferences).not.toHaveBeenCalled();
});
test('BF275 late success for A never edits B or displays A success in the new business', async () => {
  const pending = deferred<Awaited<ReturnType<typeof businessSettingsService.updatePreferences>>>();
  service.updatePreferences.mockReturnValueOnce(pending.promise);
  const view = await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  businessMock.mockReturnValue(business('b'));
  await view.rerender(<NotificationRoute />);
  await ready(false);
  const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
  await act(async () => {
    stored.set('a', false);
    pending.resolve({ data: preferences('a'), error: null });
  });
  await ready(false);
  expect(screen.queryByText('Preferencia guardada.')).toBeNull();
  expect(service.updatePreferences).toHaveBeenCalledTimes(1);
  expect(service.updatePreferences).toHaveBeenCalledWith('a', { low_stock_notifications: false });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: businessSettingsKey({ businessId: 'a', membershipId: 'm-a', userId: 'u' }),
    exact: true,
  });
  expect(invalidate).not.toHaveBeenCalledWith({
    queryKey: businessSettingsKey({ businessId: 'b', membershipId: 'm-b', userId: 'u' }),
    exact: true,
  });
});
test('BF275 identity change in the same business cannot receive an old form completion', async () => {
  const pending = deferred<Awaited<ReturnType<typeof businessSettingsService.updatePreferences>>>();
  service.updatePreferences.mockReturnValueOnce(pending.promise);
  const view = await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  authMock.mockReturnValue(auth('other'));
  await view.rerender(<NotificationRoute />);
  await ready(true);
  await act(async () =>
    pending.resolve({ data: { ...preferences(), low_stock_notifications: false }, error: null }),
  );
  await ready(true);
  expect(screen.queryByText('Preferencia guardada.')).toBeNull();
});
test('BF275 role loss during save removes the editor and late completion cannot restore it', async () => {
  const pending = deferred<Awaited<ReturnType<typeof businessSettingsService.updatePreferences>>>();
  service.updatePreferences.mockReturnValueOnce(pending.promise);
  const view = await renderWithProviders(<NotificationRoute />);
  await ready();
  await press('Avisos de stock bajo: Sí');
  await press('Guardar notificaciones');
  businessMock.mockReturnValue(business('a', 'BARBER'));
  await view.rerender(<NotificationRoute />);
  await act(async () => pending.resolve({ data: preferences(), error: null }));
  expect(screen.queryByRole('button', { name: 'Guardar notificaciones' })).toBeNull();
  expect(screen.queryByText('Preferencia guardada.')).toBeNull();
});
test('BF275 lost auth cannot query settings despite a cached OWNER business', async () => {
  authMock.mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await renderWithProviders(<NotificationRoute />);
  expect(service.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Guardar notificaciones' })).toBeNull();
});
test.each(['OWNER', 'BARBER'] as const)(
  'BF275 %s hub entry follows administrative access',
  async (role) => {
    businessMock.mockReturnValue(business('a', role));
    await renderWithProviders(<SettingsScreen />);
    if (role === 'OWNER') {
      await press('Configurar notificaciones');
      expect(routerMock.push).toHaveBeenCalledWith('/settings/notifications');
    } else expect(screen.queryByRole('button', { name: 'Configurar notificaciones' })).toBeNull();
  },
);
test('BF275 existing boolean validator refuses null/string/number coercion', () => {
  for (const value of [null, undefined, 'true', 1, 0])
    expect(businessPreferencesSchema.shape.low_stock_notifications.safeParse(value).success).toBe(
      false,
    );
});
test('BF280 Notification return targets existing Settings without pushing a duplicate', async () => {
  await renderWithProviders(<NotificationRoute />);
  await press('Volver a Configuración');
  expect(routerMock.dismissTo).toHaveBeenCalledWith('/settings');
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(routerMock.replace).not.toHaveBeenCalled();
});
