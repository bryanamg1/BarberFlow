import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import SettingsRoute from '@/app/(app)/settings';
import { authService } from '@/features/auth/services/authService';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { SettingsScreen } from '@/features/business/screens/SettingsScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/auth/services/authService', () => ({ authService: { signOut: jest.fn() } }));
jest.mock('expo-router', () => ({
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const businessMock = jest.mocked(useBusiness);
const signOut = jest.mocked(authService.signOut);
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const press = (label: string) => fireEvent.press(screen.getByRole('button', { name: label }));
const admin = ['Configuración del negocio', 'Categorías de gastos', 'Horarios de atención'];
beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  signOut.mockResolvedValue({ data: null, error: null });
});

test('BF270 existing route is the feature screen adapter', () => {
  expect(SettingsRoute).toBe(SettingsScreen);
});
test('BF270 OWNER sees six approved sections and exactly one preserved category entry', async () => {
  await renderWithProviders(<SettingsRoute />);
  for (const name of [
    'Perfil',
    'Negocio',
    'Horarios',
    'Medios de pago',
    'Notificaciones',
    'Apariencia',
  ]) {
    expect(screen.getByRole('heading', { name })).toBeOnTheScreen();
  }
  for (const name of admin) expect(screen.getAllByRole('button', { name })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeOnTheScreen();
});
test.each([
  ['Configuración del negocio', '/business/settings'],
  ['Horarios de atención', '/business/hours'],
  ['Categorías de gastos', '/expenses/categories'],
  ['Servicios', '/services'],
])('BF270 %s opens only its existing literal destination', async (label, path) => {
  await renderWithProviders(<SettingsScreen />);
  await press(label);
  expect(routerMock.push).toHaveBeenCalledTimes(1);
  expect(routerMock.push).toHaveBeenCalledWith(path);
  expect(signOut).not.toHaveBeenCalled();
});
test('BF270 BARBER has catalog/logout and information without administrative controls', async () => {
  businessMock.mockReturnValue(business('b', 'BARBER'));
  await renderWithProviders(<SettingsScreen />);
  for (const name of admin) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.getByText(/Solo un OWNER/)).toBeOnTheScreen();
  await press('Servicios');
  expect(routerMock.push).toHaveBeenCalledWith('/services');
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeOnTheScreen();
});
test('BF270 pending business hides navigation and retains working logout', async () => {
  businessMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  await renderWithProviders(<SettingsScreen />);
  expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
  for (const name of [...admin, 'Servicios'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  await press('Cerrar sesión');
  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
});
test('BF270 business failure shows the safe context error without stale routes', async () => {
  businessMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'NETWORK_ERROR', message: 'No se pudo cargar el negocio.' },
  });
  await renderWithProviders(<SettingsScreen />);
  expect(screen.getByText('No se pudo cargar el negocio.')).toBeOnTheScreen();
  for (const name of [...admin, 'Servicios'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeOnTheScreen();
});
test('BF270 idle context shows unavailable state without inventing tenant fallback', async () => {
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await renderWithProviders(<SettingsScreen />);
  expect(screen.getByRole('status', { name: 'Negocio no disponible' })).toBeOnTheScreen();
  for (const name of admin) expect(screen.queryByRole('button', { name })).toBeNull();
});
test('BF270 role/context loss removes previously visible admin controls immediately', async () => {
  const view = await renderWithProviders(<SettingsScreen />);
  businessMock.mockReturnValue(business('other', 'BARBER'));
  await view.rerender(<SettingsScreen />);
  for (const name of admin) expect(screen.queryByRole('button', { name })).toBeNull();
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await view.rerender(<SettingsScreen />);
  expect(screen.queryByRole('button', { name: 'Servicios' })).toBeNull();
  expect(routerMock.push).not.toHaveBeenCalled();
});
test('BF270 unsupported settings are information, with no fake editable fields or routes', async () => {
  await renderWithProviders(<SettingsScreen />);
  expect(screen.getByRole('button', { name: 'Editar perfil' })).toBeOnTheScreen();
  expect(screen.getByText(/Cinco medios de pago fijos/)).toBeOnTheScreen();
  expect(screen.getByText('Preferencia de avisos de stock bajo del negocio.')).toBeOnTheScreen();
  expect(screen.getByText('Tema oscuro.')).toBeOnTheScreen();
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  for (const name of ['Perfil', 'Medios de pago', 'Notificaciones', 'Apariencia']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});
test('BF270 preserves real LogoutButton pending guard and normalized error/retry', async () => {
  let finish!: (result: Awaited<ReturnType<typeof authService.signOut>>) => void;
  signOut.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await renderWithProviders(<SettingsScreen />);
  await press('Cerrar sesión');
  await press('Cerrar sesión');
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeDisabled();
  await act(async () =>
    finish({ data: null, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión.');
  await press('Cerrar sesión');
  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2));
  expect(routerMock.push).not.toHaveBeenCalled();
});
