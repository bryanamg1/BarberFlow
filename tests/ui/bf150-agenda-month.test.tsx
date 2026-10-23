import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { useMemo } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useAgendaPresentation } from '@/features/appointments/components/AgendaPresentation';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { AgendaMonthView } from '@/features/appointments/components/AgendaMonthView';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { agendaMonth } from '@/features/appointments/utils/agendaCalendar';
import type { AppointmentRow } from '@/features/appointments/types/appointment.types';
import { renderWithProviders } from '@/test/renderWithProviders';

import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { listByRange: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No calendar SDK or mutations');
});
const selectDate = jest.fn(),
  selectAppointment = jest.fn();
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T01:00:00Z'));
  jest
    .mocked(appointmentsService.listByRange)
    .mockResolvedValue({ data: [agendaRow()], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const view = (appointments: AppointmentRow[] = [], civilMonth = '2026-10') => (
  <AgendaMonthView
    civilMonth={civilMonth}
    appointments={appointments}
    onSelectDate={selectDate}
    onSelectAppointment={selectAppointment}
    selectedDate="2026-10-01"
  />
);
// BF155 will own this composition. Test BF146 compatibility without implementing its screen.
function Reader({ civilMonth = '2026-10' }: { civilMonth?: string }) {
  const business = useBusiness(),
    timezone = business.status === 'success' ? business.data.business.timezone : 'UTC';
  const range = useMemo(() => agendaMonth(civilMonth, timezone).range, [civilMonth, timezone]);
  const result = useAppointments(range);
  return (
    <AgendaMonthView
      civilMonth={civilMonth}
      appointments={result.status === 'success' ? result.data : []}
      loading={result.status === 'pending' || result.isFetching}
      error={result.error?.message}
      onRetry={() => {
        void result.refetch();
      }}
      onSelectDate={selectDate}
      onSelectAppointment={selectAppointment}
    />
  );
}

test('controlled month renders 31 accessible civil dates, selected date and business today without owning navigation', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  await renderWithProviders(view());
  expect(screen.getByRole('heading', { name: 'octubre de 2026' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /0 turnos visibles/ })).toHaveLength(31);
  const first = screen.getByRole('button', { name: /jueves, 1 de octubre de 2026, Hoy/ });
  expect(first.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(first);
  expect(selectDate).toHaveBeenCalledWith('2026-10-01');
  expect(screen.queryByRole('button', { name: /Anterior|Siguiente/ })).toBeNull();
});
test('cross-midnight original appointment is selectable on both days with real range and textual continuation', async () => {
  await renderWithProviders(view([agendaRow()]));
  expect(screen.getAllByRole('button', { name: /1 turnos visibles/ })).toHaveLength(2);
  const start = screen.getByRole('button', { name: /^Turno, (?!Continúa)/ });
  const continuation = screen.getByRole('button', { name: /^Turno, Continúa/ });
  expect(start.props.accessibilityLabel).toContain('23:30');
  expect(continuation.props.accessibilityLabel).toContain('23:30');
  expect(continuation.props.accessibilityLabel).toContain('00:30');
  await fireEvent.press(start);
  await fireEvent.press(continuation);
  expect(selectAppointment.mock.calls).toEqual([['a'], ['a']]);
});
test('exact midnight end appears only on preceding day while a midnight start belongs to next day', async () => {
  await renderWithProviders(
    view([
      agendaRow('a', '2026-10-01T23:30:00Z', '2026-10-02T00:00:00Z'),
      agendaRow('b', '2026-10-02T00:00:00Z', '2026-10-02T01:00:00Z'),
    ]),
  );
  expect(screen.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^Turno, Continúa/ })).toBeNull();
});
test('all six statuses have labels and semantic presentation without filtering historical appointments', async () => {
  const statuses = [
    'PENDING',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ] as const;
  await renderWithProviders(
    view(
      statuses.map((status, i) =>
        agendaRow(String(i), '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', { status }),
      ),
    ),
  );
  for (const label of [
    'Pendiente',
    'Confirmada',
    'En curso',
    'Completada',
    'Cancelada',
    'No asistió',
  ])
    expect(screen.getByRole('button', { name: new RegExp(`^Turno,.*${label}`) })).toBeTruthy();
});
test('loading/error/empty are separate supplied states and retry is explicit', async () => {
  const retry = jest.fn();
  const props = {
    civilMonth: '2026-10',
    appointments: [],
    onSelectDate: selectDate,
    onSelectAppointment: selectAppointment,
  };
  const { rerender } = await renderWithProviders(<AgendaMonthView {...props} loading />);
  expect(screen.getByText('Cargando turnos del mes…')).toBeTruthy();
  expect(screen.queryByText('No hay turnos visibles en este mes')).toBeNull();
  await rerender(
    <AgendaMonthView {...props} error="No se pudo consultar la agenda." onRetry={retry} />,
  );
  expect(screen.getByText('No se pudo consultar la agenda.')).toBeTruthy();
  expect(screen.queryByText('No hay turnos visibles en este mes')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await rerender(<AgendaMonthView {...props} />);
  expect(screen.getByText('No hay turnos visibles en este mes')).toBeTruthy();
});
test('invalid civil month or business timezone is a safe error, never a guessed device timezone', async () => {
  const { rerender } = await renderWithProviders(view([], '2026-13'));
  expect(screen.getByText('El mes de la agenda no es válido.')).toBeTruthy();
  agendaContext({ timezone: 'bad/zone' });
  await rerender(view());
  expect(screen.getByText('La zona horaria del negocio no está disponible.')).toBeTruthy();
});
test('the shared lifecycle guard rejects callbacks from an obsolete month/context', async () => {
  const { result, rerender } = await renderHook<
    ReturnType<typeof useAgendaPresentation>,
    { month: string }
  >(({ month }) => useAgendaPresentation(month), { initialProps: { month: '2026-10' } });
  const old = result.current.isCurrent;
  expect(old()).toBe(true);
  await rerender({ month: '2026-11' });
  expect(old()).toBe(false);
  expect(result.current.isCurrent()).toBe(true);
});
test('BF146 integration uses one month range, not per-cell requests, and handles refresh errors safely', async () => {
  agendaContext({ timezone: 'America/New_York' });
  await renderWithProviders(<Reader civilMonth="2026-03" />);
  await screen.findByRole('heading', { name: 'marzo de 2026' });
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1);
  expect(appointmentsService.listByRange).toHaveBeenCalledWith('b', {
    from: '2026-03-01T05:00:00.000Z',
    to: '2026-04-01T04:00:00.000Z',
  });
});
test.each(['user', 'business', 'membership', 'role', 'logout', 'timezone'])(
  'BF146 rejects late old %s result and never exposes old rows in the new calendar',
  async (mode) => {
    let resolve!: (value: { data: AppointmentRow[]; error: null }) => void;
    jest.mocked(appointmentsService.listByRange).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { rerender } = await renderWithProviders(<Reader />);
    await waitFor(() => expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1));
    if (mode === 'user') agendaContext({ userId: 'new-user' });
    if (mode === 'business') agendaContext({ businessId: 'new-business' });
    if (mode === 'membership') agendaContext({ membershipId: 'new-membership' });
    if (mode === 'role') agendaContext({ role: 'BARBER' });
    if (mode === 'timezone') agendaContext({ timezone: 'America/New_York' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
    await rerender(<Reader />);
    await act(() => {
      resolve({ data: [agendaRow('old')], error: null });
    });
    expect(screen.queryByRole('button', { name: /^Turno,/ })).toBeNull();
  },
);
