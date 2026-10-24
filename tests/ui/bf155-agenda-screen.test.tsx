import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import AgendaRoute from '@/app/(app)/(tabs)/agenda';
import { AgendaScreen } from '@/features/appointments/screens/AgendaScreen';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import type { AppointmentRow } from '@/features/appointments/types/appointment.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { listByRange: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No screen SDK bypass');
});
const one = () => agendaRow('one', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z');
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  resetRouterMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T01:00:00Z'));
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [one()], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

test('existing route adapts actual screen with initial business Today/day and one BF146 read', async () => {
  expect(AgendaRoute).toBe(AgendaScreen);
  await renderWithProviders(<AgendaRoute />);
  await screen.findByRole('button', { name: /^Turno,/ });
  expect(screen.getByRole('heading', { name: 'Agenda' })).toBeTruthy();
  expect(screen.getByText('Vista actual: Día')).toBeTruthy();
  expect(screen.getByText('Hoy')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'viernes, 2 de octubre de 2026' })).toBeTruthy();
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1);
  expect(appointmentsService.listByRange).toHaveBeenCalledWith('b', {
    from: '2026-10-02T00:00:00.000Z',
    to: '2026-10-03T00:00:00.000Z',
  });
  expect(screen.queryByRole('button', { name: /Anterior|Siguiente/ })).toBeNull();
});
test('one active representation Day→Week→Month→Day preserves one anchor and queries only active ranges', async () => {
  await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('button', { name: /^Turno,/ });
  await fireEvent.press(screen.getByRole('button', { name: 'Semana' }));
  await screen.findByRole('heading', { name: 'Semana del lunes, 28 de septiembre de 2026' });
  expect(screen.queryByRole('heading', { name: 'viernes, 2 de octubre de 2026' })).toBeNull();
  expect(appointmentsService.listByRange).toHaveBeenLastCalledWith('b', {
    from: '2026-09-28T00:00:00.000Z',
    to: '2026-10-05T00:00:00.000Z',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await screen.findByRole('heading', { name: 'octubre de 2026' });
  expect(screen.queryByRole('heading', { name: /^Semana del/ })).toBeNull();
  expect(appointmentsService.listByRange).toHaveBeenLastCalledWith('b', {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Día' }));
  await screen.findByRole('heading', { name: 'viernes, 2 de octubre de 2026' });
  expect(screen.queryByRole('heading', { name: 'octubre de 2026' })).toBeNull();
});
test('month date selection updates shared anchor without automatic Day switching or duplicate range reads', async () => {
  await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('button', { name: /^Turno,/ });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await screen.findByRole('heading', { name: 'octubre de 2026' });
  const calls = jest.mocked(appointmentsService.listByRange).mock.calls.length;
  await fireEvent.press(screen.getByRole('button', { name: /miércoles, 14 de octubre de 2026/ }));
  expect(screen.getByText('Vista actual: Mes')).toBeTruthy();
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(calls);
  await fireEvent.press(screen.getByRole('button', { name: 'Día' }));
  await screen.findByRole('heading', { name: 'miércoles, 14 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Semana' }));
  await screen.findByRole('heading', { name: 'Semana del lunes, 12 de octubre de 2026' });
});
test('business timezone supplies initial date and active query bounds; UTC date is not the anchor authority', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
  expect(appointmentsService.listByRange).toHaveBeenCalledWith('b', {
    from: '2026-10-01T03:00:00.000Z',
    to: '2026-10-02T03:00:00.000Z',
  });
  expect(screen.getByText('Hoy')).toBeTruthy();
});
test('multiple cards use one read and selection routes only the original appointment ID', async () => {
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({
    data: [one(), { ...one(), id: 'two' }, { ...one(), id: 'foreign', business_id: 'other' }],
    error: null,
  });
  await renderWithProviders(<AgendaScreen />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(2));
  const entries = screen.getAllByRole('button', { name: /^Turno,/ });
  expect(entries).toHaveLength(2);
  await fireEvent.press(entries[0]);
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/appointments/[id]',
    params: { id: 'one' },
  });
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1);
});
test('query loading is not empty; error is safe; explicit retry uses the existing read hook', async () => {
  let resolve!: (v: { data: null; error: { code: 'NETWORK_ERROR'; message: string } }) => void;
  jest.mocked(appointmentsService.listByRange).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await renderWithProviders(<AgendaScreen />);
  expect(screen.getByText('Cargando turnos del día…')).toBeTruthy();
  expect(screen.queryByText('No hay turnos visibles en este día')).toBeNull();
  await act(() =>
    resolve({
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'unsafe raw provider detail' },
    }),
  );
  await screen.findByRole('button', { name: 'Reintentar' });
  expect(screen.queryByText('unsafe raw provider detail')).toBeNull();
  expect(screen.queryByText('No hay turnos visibles en este día')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('button', { name: /^Turno,/ });
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(2);
});
test('empty states distinguish active Day/Week/Month without mounting inactive calendars', async () => {
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
  await renderWithProviders(<AgendaScreen />);
  await screen.findByText('No hay turnos visibles en este día');
  await fireEvent.press(screen.getByRole('button', { name: 'Semana' }));
  await screen.findByText('No hay turnos visibles en esta semana');
  expect(screen.queryByText('No hay turnos visibles en este día')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await screen.findByText('No hay turnos visibles en este mes');
  expect(screen.queryByText('No hay turnos visibles en esta semana')).toBeNull();
});
test('context loading and invalid timezone do not issue a query or masquerade as empty appointments', async () => {
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  const { rerender } = await renderWithProviders(<AgendaScreen />);
  expect(screen.getByText('Cargando negocio…')).toBeTruthy();
  expect(appointmentsService.listByRange).not.toHaveBeenCalled();
  jest.mocked(useBusiness).mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'UNKNOWN_ERROR', message: 'unsafe business error' },
  });
  await rerender(<AgendaScreen />);
  expect(screen.getByText('No se pudo cargar el negocio para mostrar la agenda.')).toBeTruthy();
  expect(screen.queryByText('unsafe business error')).toBeNull();
  agendaContext({ timezone: 'bad/zone' });
  await rerender(<AgendaScreen />);
  expect(screen.getByText('La zona horaria del negocio no está disponible.')).toBeTruthy();
  expect(appointmentsService.listByRange).not.toHaveBeenCalled();
});
test('active BARBER and inactive business do not acquire new frontend permission restrictions', async () => {
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    error: null,
    isFetching: false,
    data: {
      membershipId: 'm',
      role: 'BARBER',
      business: {
        id: 'b',
        name: 'Demo',
        timezone: 'UTC',
        currency_code: 'ARS',
        is_active: false,
      },
    },
  });
  await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('button', { name: /^Turno,/ });
  expect(appointmentsService.listByRange).toHaveBeenCalledWith('b', expect.anything());
});
test('business change resets selected view/date to the new context Today/day', async () => {
  const { rerender } = await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('button', { name: /^Turno,/ });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await screen.findByRole('heading', { name: 'octubre de 2026' });
  agendaContext({ businessId: 'new-business', timezone: 'America/Argentina/Buenos_Aires' });
  await rerender(<AgendaScreen />);
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
  expect(screen.getByText('Vista actual: Día')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'octubre de 2026' })).toBeNull();
});
test('a late Day result cannot populate the newly selected Month query', async () => {
  let resolve!: (v: { data: AppointmentRow[]; error: null }) => void;
  jest.mocked(appointmentsService.listByRange).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await renderWithProviders(<AgendaScreen />);
  await waitFor(() => expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1));
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await screen.findByText('No hay turnos visibles en este mes');
  await act(() => resolve({ data: [one()], error: null }));
  expect(screen.queryByRole('button', { name: /^Turno,/ })).toBeNull();
  expect(screen.getByText('Vista actual: Mes')).toBeTruthy();
});
test.each(['user', 'business', 'membership', 'role', 'timezone', 'logout'])(
  'late old %s result cannot populate the current screen or navigate',
  async (mode) => {
    let resolve!: (v: { data: AppointmentRow[]; error: null }) => void;
    jest.mocked(appointmentsService.listByRange).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { rerender } = await renderWithProviders(<AgendaScreen />);
    await waitFor(() => expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1));
    if (mode === 'user') agendaContext({ userId: 'new-user' });
    if (mode === 'business') agendaContext({ businessId: 'new-business' });
    if (mode === 'membership') agendaContext({ membershipId: 'new-member' });
    if (mode === 'role') agendaContext({ role: 'BARBER' });
    if (mode === 'timezone') agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
    await rerender(<AgendaScreen />);
    await act(() => resolve({ data: [one()], error: null }));
    expect(screen.queryByRole('button', { name: /^Turno,/ })).toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
  },
);
