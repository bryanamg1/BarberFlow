import { fireEvent, screen } from '@testing-library/react-native';

import PaymentRoute from '@/app/(app)/settings/payment-methods';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { PaymentMethodSettingsScreen } from '@/features/business/screens/PaymentMethodSettingsScreen';
import { SettingsScreen } from '@/features/business/screens/SettingsScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));
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
const businessMock = jest.mocked(useBusiness);
const canGoBack = jest.mocked(
  jest.requireMock<{ router: { canGoBack: jest.Mock } }>('expo-router').router.canGoBack,
);
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
const labels = [
  'Efectivo',
  'Transferencia bancaria',
  'Tarjeta de débito',
  'Tarjeta de crédito',
  'Billetera digital / QR',
];
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  canGoBack.mockReturnValue(false);
});

test('BF274 route exports only the actual feature screen', () => {
  expect(PaymentRoute).toBe(PaymentMethodSettingsScreen);
});
test.each(['OWNER', 'BARBER'] as const)(
  'BF274 %s sees exactly the five fixed methods and recording-only boundary',
  async (role) => {
    businessMock.mockReturnValue(business(role));
    await renderWithProviders(<PaymentRoute />);
    for (const label of labels) expect(screen.getAllByText(label)).toHaveLength(1);
    expect(screen.getByText(/No se pueden activar, desactivar ni personalizar/)).toBeOnTheScreen();
    expect(screen.getByText(/solo registra el medio de pago/)).toBeOnTheScreen();
    for (const legacy of ['OTHER', 'TRANSFER', 'DEBIT', 'CREDIT', 'Mercado Pago', 'Stripe'])
      expect(screen.queryByText(legacy)).toBeNull();
  },
);
test('BF274 has no editable setting, checkbox, method toggle or save action', async () => {
  await renderWithProviders(<PaymentRoute />);
  for (const role of ['textbox', 'switch', 'checkbox', 'radio'])
    expect(screen.queryAllByRole(role)).toHaveLength(0);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Volver a Configuración' })).toBeEnabled();
  expect(routerMock.push).not.toHaveBeenCalled();
});
test('BF274 pending business cannot expose cached operational information', async () => {
  businessMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  await renderWithProviders(<PaymentRoute />);
  expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
  expect(screen.queryByText('Efectivo')).toBeNull();
});
test('BF274 safe context error replaces the fixed list', async () => {
  businessMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'NETWORK_ERROR', message: 'No se pudo cargar el negocio.' },
  });
  await renderWithProviders(<PaymentRoute />);
  expect(screen.getByText('No se pudo cargar el negocio.')).toBeOnTheScreen();
  expect(screen.queryByText('Efectivo')).toBeNull();
});
test('BF274 idle context uses unavailable state with no fallback business', async () => {
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await renderWithProviders(<PaymentRoute />);
  expect(screen.getByRole('status', { name: 'Negocio no disponible' })).toBeOnTheScreen();
  expect(screen.queryByText('Efectivo')).toBeNull();
});
test('BF274 context loss removes the list and a new business has the same fixed methods', async () => {
  const view = await renderWithProviders(<PaymentRoute />);
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await view.rerender(<PaymentRoute />);
  expect(screen.queryByText('Efectivo')).toBeNull();
  businessMock.mockReturnValue(business('BARBER', 'other'));
  await view.rerender(<PaymentRoute />);
  for (const label of labels) expect(screen.getByText(label)).toBeOnTheScreen();
});
test('BF274 named Settings return ignores unrelated back-stack history', async () => {
  canGoBack.mockReturnValue(true);
  await renderWithProviders(<PaymentRoute />);
  await press('Volver a Configuración');
  expect(routerMock.back).not.toHaveBeenCalled();
  expect(routerMock.dismissTo).toHaveBeenCalledWith('/settings');
});
test('BF274 direct deep link safely returns to Settings', async () => {
  await renderWithProviders(<PaymentRoute />);
  await press('Volver a Configuración');
  expect(routerMock.dismissTo).toHaveBeenCalledWith('/settings');
  expect(routerMock.back).not.toHaveBeenCalled();
});
test.each(['OWNER', 'BARBER'] as const)(
  'BF274 %s hub entry navigates to the single protected stack destination',
  async (role) => {
    businessMock.mockReturnValue(business(role));
    await renderWithProviders(<SettingsScreen />);
    expect(screen.getAllByRole('button', { name: 'Ver medios de pago' })).toHaveLength(1);
    await press('Ver medios de pago');
    expect(routerMock.push).toHaveBeenCalledWith('/settings/payment-methods');
  },
);
test('BF274 unavailable hub context does not offer the payment route', async () => {
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await renderWithProviders(<SettingsScreen />);
  expect(screen.queryByRole('button', { name: 'Ver medios de pago' })).toBeNull();
});
