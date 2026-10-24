import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AgendaScreen } from '@/features/appointments/screens/AgendaScreen';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import type { AppointmentRow } from '@/features/appointments/types/appointment.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { renderWithProviders } from '@/test/renderWithProviders';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true, router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { listByRange: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK');
});
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T01:00:00Z'));
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
test('controlled previous/next update Day and one reader; view switch preserves navigated anchor', async () => {
  await renderWithProviders(<AgendaScreen />);
  await screen.findByText('No hay turnos visibles en este día');
  await fireEvent.press(screen.getByRole('button', { name: 'Día anterior' }));
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Día siguiente' }));
  await screen.findByRole('heading', { name: 'viernes, 2 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Semana' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Semana siguiente' }));
  await screen.findByRole('heading', { name: 'Semana del lunes, 5 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Semana anterior' }));
  await screen.findByRole('heading', { name: 'Semana del lunes, 28 de septiembre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Mes siguiente' }));
  await screen.findByRole('heading', { name: 'noviembre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes anterior' }));
  await screen.findByRole('heading', { name: 'octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Día' }));
  await screen.findByRole('heading', { name: 'viernes, 2 de octubre de 2026' });
  expect(appointmentsService.listByRange).toHaveBeenLastCalledWith('b', {
    from: '2026-10-02T00:00:00.000Z',
    to: '2026-10-03T00:00:00.000Z',
  });
});
test('Today computes fresh business civil date and retains current view', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Mes' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Mes anterior' }));
  await screen.findByRole('heading', { name: 'septiembre de 2026' });
  jest.mocked(Date.now).mockReturnValue(Date.parse('2026-11-01T01:00:00Z'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Ir a hoy en la zona horaria del negocio' }),
  );
  await screen.findByRole('heading', { name: 'octubre de 2026' });
  expect(screen.getByText('Vista actual: Mes')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Día' }));
  await screen.findByRole('heading', { name: 'sábado, 31 de octubre de 2026' });
});
test('rapid previous→next→next ignores delayed old range and keeps latest query', async () => {
  let resolve!: (v: { data: AppointmentRow[]; error: null }) => void;
  jest.mocked(appointmentsService.listByRange).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await renderWithProviders(<AgendaScreen />);
  await waitFor(() => expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1));
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
  for (const name of ['Día anterior', 'Día siguiente', 'Día siguiente'])
    await fireEvent.press(screen.getByRole('button', { name }));
  await screen.findByRole('heading', { name: 'sábado, 3 de octubre de 2026' });
  await act(() => resolve({ data: [agendaRow('stale')], error: null }));
  expect(screen.queryByRole('button', { name: /^Turno,/ })).toBeNull();
  expect(appointmentsService.listByRange).toHaveBeenLastCalledWith('b', {
    from: '2026-10-03T00:00:00.000Z',
    to: '2026-10-04T00:00:00.000Z',
  });
});
test.each(['user', 'business', 'membership', 'role', 'timezone', 'logout'])(
  'navigated anchor resets safely on %s change',
  async (mode) => {
    const { rerender } = await renderWithProviders(<AgendaScreen />);
    await screen.findByText('No hay turnos visibles en este día');
    await fireEvent.press(screen.getByRole('button', { name: 'Día siguiente' }));
    await screen.findByRole('heading', { name: 'sábado, 3 de octubre de 2026' });
    if (mode === 'user') agendaContext({ userId: 'new-u' });
    if (mode === 'business') agendaContext({ businessId: 'new-b' });
    if (mode === 'membership') agendaContext({ membershipId: 'new-m' });
    if (mode === 'role') agendaContext({ role: 'BARBER' });
    if (mode === 'timezone') agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await rerender(<AgendaScreen />);
    expect(screen.queryByRole('heading', { name: 'sábado, 3 de octubre de 2026' })).toBeNull();
    if (mode === 'logout')
      expect(screen.queryByRole('button', { name: 'Día siguiente' })).toBeNull();
    else
      await screen.findByRole('heading', {
        name:
          mode === 'timezone' ? 'jueves, 1 de octubre de 2026' : 'viernes, 2 de octubre de 2026',
      });
  },
);
