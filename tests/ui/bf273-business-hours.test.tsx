import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import { businessDays } from '@/features/business/constants/businessDays';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { BusinessHoursScreen } from '@/features/business/screens/BusinessHoursScreen';
import { businessHoursService } from '@/features/business/services/businessHoursService';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/business/services/businessHoursService', () => ({
  businessHoursService: { get: jest.fn(), save: jest.fn() },
}));
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: {},
  settingsError: (code: string) => ({ code, message: 'Acceso denegado.' }),
}));
const businessMock = jest.mocked(useBusiness);
const authMock = jest.mocked(useAuth);
const service = jest.mocked(businessHoursService);
const rows = businessDays.map(({ day }) => ({
  id: 'hour-' + day,
  business_id: 'b',
  day_of_week: day,
  open_time: '09:00:00.123456',
  close_time: '18:00:00.123456',
  is_closed: day === 0,
}));
const business = (
  id = 'b',
  role: 'OWNER' | 'BARBER' = 'OWNER',
  timezone = 'America/Argentina/Buenos_Aires',
): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'm-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone, is_active: true },
  },
});
const auth = { status: 'authenticated', user: { id: 'u' }, session: {}, error: null } as AuthState;
const input = (name: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(name), value);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
async function ready() {
  await waitFor(() => expect(screen.getByLabelText('Lunes: apertura')).toBeOnTheScreen());
}
beforeEach(() => {
  authMock.mockReturnValue(auth);
  businessMock.mockReturnValue(business());
  service.get.mockResolvedValue({ data: rows, error: null });
  service.save.mockImplementation(async (id, days) => ({
    data: days.map((day) => ({ ...day, id: 'hour-' + day.day_of_week, business_id: id })),
    error: null,
  }));
});
test('BF273 seven civil weekdays use current business timezone; retain closed times', async () => {
  await renderWithProviders(<BusinessHoursScreen />);
  await ready();
  expect(
    screen.getByText(/Horarios locales en America\/Argentina\/Buenos_Aires/),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Domingo: apertura')).toHaveProp('editable', false);
  expect(screen.getByLabelText('Domingo: apertura')).toHaveProp('value', '09:00:00.123456');
  await input('Lunes: cierre', '19:00');
  await press('Guardar horarios');
  await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
  expect(service.save).toHaveBeenCalledWith(
    'b',
    rows.map(({ id: _id, business_id: _business, ...day }) => ({
      ...day,
      ...(day.day_of_week === 1 ? { close_time: '19:00' } : {}),
    })),
  );
  await waitFor(() => expect(screen.getByText('Horarios guardados.')).toBeOnTheScreen());
});
test('BF273 marking a configured day closed preserves both times without enabling edits', async () => {
  await renderWithProviders(<BusinessHoursScreen />);
  await ready();
  await press('Lunes: marcar cerrado');
  expect(screen.getByLabelText('Lunes: apertura')).toHaveProp('editable', false);
  await press('Guardar horarios');
  await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
  expect(service.save.mock.calls[0][1][1]).toEqual({
    day_of_week: 1,
    open_time: '09:00:00.123456',
    close_time: '18:00:00.123456',
    is_closed: true,
  });
});
test('BF273 empty week has no invented hours; new closed days require explicit times', async () => {
  service.get.mockResolvedValue({ data: [], error: null });
  await renderWithProviders(<BusinessHoursScreen />);
  await ready();
  expect(screen.getAllByText('Sin configurar')).toHaveLength(7);
  expect(screen.getByLabelText('Lunes: apertura')).toHaveProp('value', '');
  await press('Domingo: marcar cerrado');
  await press('Guardar horarios');
  expect(service.save).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Domingo: apertura')).toHaveProp('editable', true);
  for (const { label } of businessDays) {
    await input(label + ': apertura', '10:00');
    await input(label + ': cierre', '17:00');
  }
  await press('Guardar horarios');
  await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));
  expect(service.save.mock.calls[0][1][0]).toEqual({
    day_of_week: 0,
    open_time: '10:00',
    close_time: '17:00',
    is_closed: true,
  });
});
test('BF273 invalid open interval and blank time never save', async () => {
  await renderWithProviders(<BusinessHoursScreen />);
  await ready();
  await input('Lunes: cierre', '08:00');
  await press('Guardar horarios');
  await waitFor(() =>
    expect(screen.getByText(/Error: El cierre debe ser posterior/)).toBeOnTheScreen(),
  );
  expect(service.save).not.toHaveBeenCalled();
  await input('Lunes: cierre', '');
  await press('Guardar horarios');
  expect(service.save).not.toHaveBeenCalled();
});
test('BF273 safe write error retains all draft values and closed flags', async () => {
  service.save.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No se pudo conectar.' },
  });
  await renderWithProviders(<BusinessHoursScreen />);
  await ready();
  await input('Lunes: cierre', '20:00');
  await press('Martes: marcar cerrado');
  await press('Guardar horarios');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No se pudo conectar.'));
  expect(screen.getByLabelText('Lunes: cierre')).toHaveProp('value', '20:00');
  expect(screen.getByRole('button', { name: 'Martes: marcar abierto' })).toBeOnTheScreen();
  expect(screen.queryByText('Horarios guardados.')).toBeNull();
});
test('BF273 pending save prevents repetition; late response never overwrites another tenant', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof businessHoursService.save>>) => void;
  service.save.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const view = await renderWithProviders(<BusinessHoursScreen />);
  await ready();
  const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
  await input('Lunes: cierre', '20:00');
  await press('Guardar horarios');
  await press('Guardar horarios');
  expect(service.save).toHaveBeenCalledTimes(1);
  businessMock.mockReturnValue(business('other', 'OWNER', 'UTC'));
  service.get.mockResolvedValue({
    data: rows.map((row) => ({ ...row, business_id: 'other' })),
    error: null,
  });
  await view.rerender(<BusinessHoursScreen />);
  await ready();
  await input('Lunes: cierre', '21:00');
  await act(async () => resolve({ data: rows, error: null }));
  expect(screen.getByLabelText('Lunes: cierre')).toHaveProp('value', '21:00');
  expect(screen.queryByText('Horarios guardados.')).toBeNull();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['business', 'hours', { businessId: 'b', membershipId: 'm-b', userId: 'u' }],
    exact: true,
  });
});
test('BF273 BARBER has no editor or query', async () => {
  businessMock.mockReturnValue(business('b', 'BARBER'));
  await renderWithProviders(<BusinessHoursScreen />);
  expect(screen.getByText('Acceso restringido')).toBeOnTheScreen();
  expect(service.get).not.toHaveBeenCalled();
});
test('BF273 failed read exposes retry, never fabricates a week', async () => {
  service.get.mockResolvedValue({
    data: null,
    error: { code: 'UNKNOWN_ERROR', message: 'No disponible.' },
  });
  await renderWithProviders(<BusinessHoursScreen />);
  await waitFor(() =>
    expect(screen.getByText('No se pudieron cargar los horarios.')).toBeOnTheScreen(),
  );
  expect(screen.queryByLabelText('Lunes: apertura')).toBeNull();
  service.get.mockResolvedValue({ data: rows, error: null });
  await press('Reintentar');
  await ready();
});
