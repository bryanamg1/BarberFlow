import { fireEvent, screen } from '@testing-library/react-native';

import AppearanceRoute from '@/app/(app)/settings/appearance';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { AppearanceSettingsScreen } from '@/features/business/screens/AppearanceSettingsScreen';
import { SettingsScreen } from '@/features/business/screens/SettingsScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { theme } from '@/theme';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
const businessMock = jest.mocked(useBusiness);
const business = (role: 'OWNER' | 'BARBER' = 'OWNER', id = 'b'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  businessMock.mockReturnValue(business());
});
test('BF276 thin route exposes the actual feature screen', () => {
  expect(AppearanceRoute).toBe(AppearanceSettingsScreen);
});
test.each(['OWNER', 'BARBER'] as const)(
  'BF276 %s sees fixed dark/Inter information without fake settings',
  async (role) => {
    businessMock.mockReturnValue(business(role));
    await renderWithProviders(<AppearanceRoute />);
    expect(screen.getByRole('heading', { name: 'Tema oscuro' })).toBeOnTheScreen();
    expect(screen.getByText(/tema oscuro fijo, con tipografía Inter/)).toBeOnTheScreen();
    for (const role of ['switch', 'radio', 'checkbox', 'textbox'])
      expect(screen.queryAllByRole(role)).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Apariencia' })).toHaveStyle({
      ...theme.typography.headingLg,
      color: theme.colors.textPrimary,
    });
    expect(screen.getByText(/tema oscuro fijo, con tipografía Inter/)).toHaveStyle({
      ...theme.typography.body,
      color: theme.colors.textSecondary,
    });
  },
);
test('BF276 loading replaces information while current business resolves', async () => {
  businessMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  await renderWithProviders(<AppearanceRoute />);
  expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
  expect(screen.queryByText('Tema oscuro')).toBeNull();
});
test('BF276 safe context error does not pretend a successful context', async () => {
  businessMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'NETWORK_ERROR', message: 'No se pudo cargar el negocio.' },
  });
  await renderWithProviders(<AppearanceRoute />);
  expect(screen.getByText('No se pudo cargar el negocio.')).toBeOnTheScreen();
  expect(screen.queryByText('Tema oscuro')).toBeNull();
});
test('BF276 losing context removes information and business switch keeps the same fixed appearance', async () => {
  const view = await renderWithProviders(<AppearanceRoute />);
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await view.rerender(<AppearanceRoute />);
  expect(screen.getByRole('status', { name: 'Negocio no disponible' })).toBeOnTheScreen();
  expect(screen.queryByText('Tema oscuro')).toBeNull();
  businessMock.mockReturnValue(business('BARBER', 'other'));
  await view.rerender(<AppearanceRoute />);
  expect(screen.getByText(/tema oscuro fijo, con tipografía Inter/)).toBeOnTheScreen();
});
test('BF276 reload/deep-link return uses explicit Settings destination', async () => {
  await renderWithProviders(<AppearanceRoute />);
  await fireEvent.press(screen.getByRole('button', { name: 'Volver a Configuración' }));
  expect(routerMock.dismissTo).toHaveBeenCalledWith('/settings');
  expect(routerMock.back).not.toHaveBeenCalled();
});
test.each(['OWNER', 'BARBER'] as const)(
  'BF276 %s can open Appearance from the existing hub',
  async (role) => {
    businessMock.mockReturnValue(business(role));
    await renderWithProviders(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver apariencia' }));
    expect(routerMock.push).toHaveBeenCalledWith('/settings/appearance');
  },
);
test('BF276 unavailable hub does not expose an operational appearance entry', async () => {
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await renderWithProviders(<SettingsScreen />);
  expect(screen.queryByRole('button', { name: 'Ver apariencia' })).toBeNull();
});
