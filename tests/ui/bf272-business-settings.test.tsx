import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { BusinessSettingsScreen } from '@/features/business/screens/BusinessSettingsScreen';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: {
    get: jest.fn(),
    updateProfile: jest.fn(),
    updatePreferences: jest.fn(),
  },
  settingsError: (code: string) => ({ code, message: 'Acceso denegado.' }),
}));
const businessMock = jest.mocked(useBusiness);
const authMock = jest.mocked(useAuth);
const service = jest.mocked(businessSettingsService);
const profile = {
  id: 'b',
  name: 'Demo',
  phone: null,
  email: null,
  address: null,
  currency_code: 'ARS',
  timezone: 'UTC',
};
const preferences = {
  business_id: 'b',
  appointment_interval_minutes: 30,
  default_service_buffer_minutes: 0,
  allow_overlapping_appointments: false,
  low_stock_notifications: true,
};
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const auth = { status: 'authenticated', user: { id: 'u' }, session: {}, error: null } as AuthState;
const input = (name: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(name), value);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const save = async () => await press('Guardar datos del negocio');
async function ready() {
  await waitFor(() => expect(screen.getByLabelText('Nombre del negocio')).toBeOnTheScreen());
}
beforeEach(() => {
  businessMock.mockReturnValue(business());
  authMock.mockReturnValue(auth);
  service.get.mockResolvedValue({ data: { profile, preferences }, error: null });
  service.updateProfile.mockImplementation(async (_id, patch) => ({
    data: { ...profile, ...patch },
    error: null,
  }));
  service.updatePreferences.mockImplementation(async (_id, patch) => ({
    data: { ...preferences, ...patch },
    error: null,
  }));
});
test('BF272 OWNER loads true values and sends only dirty profile fields; null untouched', async () => {
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  expect(service.get).toHaveBeenCalledWith('b');
  await input('Nombre del negocio', '  Nuevo  ');
  await input('Email', 'texto libre');
  await save();
  await save();
  await waitFor(() => expect(service.updateProfile).toHaveBeenCalledTimes(1));
  expect(service.updateProfile).toHaveBeenCalledWith('b', {
    name: '  Nuevo  ',
    email: 'texto libre',
  });
  await waitFor(() => expect(screen.getByText('Datos del negocio guardados.')).toBeOnTheScreen());
  expect(service.updatePreferences).not.toHaveBeenCalled();
});
test('BF272 timezone change requires explicit confirmation; cancel preserves draft', async () => {
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  await input('Zona horaria IANA', 'America/Argentina/Buenos_Aires');
  await save();
  await waitFor(() => expect(screen.getByText('¿Cambiar zona horaria?')).toBeOnTheScreen());
  expect(service.updateProfile).not.toHaveBeenCalled();
  await press('Seguir editando');
  expect(screen.getByLabelText('Zona horaria IANA')).toHaveProp(
    'value',
    'America/Argentina/Buenos_Aires',
  );
  await save();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirmar zona horaria' })).toBeOnTheScreen(),
  );
  await press('Confirmar zona horaria');
  await waitFor(() => expect(service.updateProfile).toHaveBeenCalledTimes(1));
  expect(service.updateProfile).toHaveBeenCalledWith('b', {
    timezone: 'America/Argentina/Buenos_Aires',
  });
});
test('BF272 invalid timezone never reaches transport', async () => {
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  await input('Zona horaria IANA', '+03:00');
  await save();
  await waitFor(() => expect(screen.getByText('Error: Revisa este campo.')).toBeOnTheScreen());
  expect(service.updateProfile).not.toHaveBeenCalled();
});
test('BF272 failed timezone save exposes its safe error inside the confirmation for retry', async () => {
  service.updateProfile.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No se pudo conectar.' },
  });
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  await input('Zona horaria IANA', 'America/New_York');
  await save();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirmar zona horaria' })).toBeOnTheScreen(),
  );
  await press('Confirmar zona horaria');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo conectar.'));
  expect(screen.getByRole('button', { name: 'Confirmar zona horaria' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Zona horaria IANA')).toHaveProp('value', 'America/New_York');
});
test('BF272 currency lock error is safe and draft is retained for another edit', async () => {
  service.updateProfile.mockResolvedValue({
    data: null,
    error: {
      code: 'BUSINESS_CURRENCY_LOCKED',
      message: 'La moneda no puede cambiar después de registrar actividad financiera.',
    },
  });
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  await input('Moneda', 'USD');
  await save();
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(/La moneda no puede cambiar/),
  );
  expect(screen.getByLabelText('Moneda')).toHaveProp('value', 'USD');
  expect(screen.queryByText('Datos del negocio guardados.')).toBeNull();
});
test('BF272 positive interval, nonnegative buffer and independent preference save', async () => {
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  await input('Intervalo de turnos (minutos)', '0');
  await press('Guardar reglas de agenda y stock');
  await waitFor(() =>
    expect(screen.getAllByText(/Ingresa un entero válido/).length).toBeGreaterThan(0),
  );
  expect(service.updatePreferences).not.toHaveBeenCalled();
  await input('Intervalo de turnos (minutos)', '15');
  await press('Permitir citas superpuestas: No');
  await press('Guardar reglas de agenda y stock');
  await waitFor(() => expect(service.updatePreferences).toHaveBeenCalledTimes(1));
  expect(service.updatePreferences).toHaveBeenCalledWith('b', {
    appointment_interval_minutes: 15,
    allow_overlapping_appointments: true,
  });
  expect(service.updateProfile).not.toHaveBeenCalled();
});
test('BF272 blank numeric never becomes zero', async () => {
  await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  await input('Buffer entre servicios (minutos)', '');
  await press('Guardar reglas de agenda y stock');
  await waitFor(() =>
    expect(screen.getAllByText(/Ingresa un entero válido/).length).toBeGreaterThan(0),
  );
  expect(service.updatePreferences).not.toHaveBeenCalled();
});
test('BF272 BARBER cannot mount editor or query', async () => {
  businessMock.mockReturnValue(business('b', 'BARBER'));
  await renderWithProviders(<BusinessSettingsScreen />);
  expect(screen.getByText('Acceso restringido')).toBeOnTheScreen();
  expect(service.get).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Nombre del negocio')).toBeNull();
});
test('BF272 failed read hides cached form and exposes retry', async () => {
  service.get.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' },
  });
  await renderWithProviders(<BusinessSettingsScreen />);
  await waitFor(() =>
    expect(screen.getByText('No se pudo cargar la configuración del negocio.')).toBeOnTheScreen(),
  );
  expect(screen.queryByLabelText('Nombre del negocio')).toBeNull();
  service.get.mockResolvedValue({ data: { profile, preferences }, error: null });
  await press('Reintentar');
  await ready();
});
test('BF272 a late save cannot replace another business draft; invalidation uses captured tenant', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof businessSettingsService.updateProfile>>) => void;
  service.updateProfile.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const view = await renderWithProviders(<BusinessSettingsScreen />);
  await ready();
  const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
  await input('Nombre del negocio', 'Old draft');
  await save();
  await waitFor(() => expect(service.updateProfile).toHaveBeenCalledTimes(1));
  businessMock.mockReturnValue(business('other'));
  service.get.mockResolvedValue({
    data: {
      profile: { ...profile, id: 'other', name: 'Other' },
      preferences: { ...preferences, business_id: 'other' },
    },
    error: null,
  });
  await view.rerender(<BusinessSettingsScreen />);
  await ready();
  await input('Nombre del negocio', 'Other draft');
  await act(async () => resolve({ data: { ...profile, name: 'Old saved' }, error: null }));
  expect(screen.getByLabelText('Nombre del negocio')).toHaveProp('value', 'Other draft');
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['business', 'settings', { businessId: 'b', membershipId: 'm-b', userId: 'u' }],
    exact: true,
  });
  expect(screen.queryByText('Datos del negocio guardados.')).toBeNull();
});
