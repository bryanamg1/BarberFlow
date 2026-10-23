import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { useMemo } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { AgendaDayView } from '@/features/appointments/components/AgendaDayView';
import { useAgendaPresentation } from '@/features/appointments/components/AgendaPresentation';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { agendaPeriod, shiftCivilDate } from '@/features/appointments/utils/agendaCalendar';
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
  throw new Error('No day SDK or mutations');
});
const select = jest.fn();
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T01:00:00Z'));
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const view = (appointments: AppointmentRow[] = [], civilDate = '2026-10-02') => (
  <AgendaDayView civilDate={civilDate} appointments={appointments} onSelectAppointment={select} />
);
// Only BF155 owns the eventual screen composition; exercise its existing BF146 source here.
function Reader({ civilDate = '2026-10-02' }: { civilDate?: string }) {
  const business = useBusiness();
  const zone = business.status === 'success' ? business.data.business.timezone : 'UTC';
  const range = useMemo(
    () => agendaPeriod(civilDate, shiftCivilDate(civilDate, 1), zone).range,
    [civilDate, zone],
  );
  const result = useAppointments(range);
  return (
    <AgendaDayView
      civilDate={civilDate}
      appointments={result.status === 'success' ? result.data : []}
      loading={result.status === 'pending' || result.isFetching}
      error={result.error?.message}
      onSelectAppointment={select}
    />
  );
}

test('controlled day heading and Today use business date, not the UTC/device date', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  const { rerender } = await renderWithProviders(view([], '2026-10-01'));
  expect(screen.getByRole('heading', { name: 'jueves, 1 de octubre de 2026' })).toBeTruthy();
  expect(screen.getByText('Hoy')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Anterior|Siguiente/ })).toBeNull();
  await rerender(view([], '2026-10-02'));
  expect(screen.queryByText('Hoy')).toBeNull();
  expect(screen.getByRole('heading', { name: 'viernes, 2 de octubre de 2026' })).toBeTruthy();
});
test('single-day and overlapping entries are distinct ordered selections using original IDs', async () => {
  await renderWithProviders(
    view([
      agendaRow('z', '2026-10-02T10:00:00Z', '2026-10-02T12:00:00Z'),
      agendaRow('a', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z'),
    ]),
  );
  const entries = screen.getAllByRole('button', { name: /^Turno,/ });
  expect(entries).toHaveLength(2);
  for (const entry of entries) await fireEvent.press(entry);
  expect(select.mock.calls).toEqual([['a'], ['z']]);
  expect(appointmentsService.listByRange).not.toHaveBeenCalled();
});
test('cross-midnight same original row appears on each selected day with honest continuation/range', async () => {
  const a = Object.freeze(agendaRow());
  const { rerender } = await renderWithProviders(view([a], '2026-10-01'));
  const first = screen.getByRole('button', { name: /^Turno,/ });
  expect(first.props.accessibilityLabel).not.toContain('Continúa');
  await fireEvent.press(first);
  await rerender(view([a], '2026-10-02'));
  const second = screen.getByRole('button', { name: /^Turno, Continúa/ });
  expect(second.props.accessibilityLabel).toContain('23:30');
  expect(second.props.accessibilityLabel).toContain('00:30');
  await fireEvent.press(second);
  expect(select.mock.calls).toEqual([['a'], ['a']]);
  expect(a.start_at).toBe('2026-10-01T23:30:00Z');
});
test('exact midnight end excluded and exact midnight start included', async () => {
  await renderWithProviders(
    view([
      agendaRow('end', '2026-10-01T22:00:00Z', '2026-10-02T00:00:00Z'),
      agendaRow('start', '2026-10-02T00:00:00Z', '2026-10-02T01:00:00Z'),
    ]),
  );
  const entries = screen.getAllByRole('button', { name: /^Turno,/ });
  expect(entries).toHaveLength(1);
  await fireEvent.press(entries[0]);
  expect(select).toHaveBeenCalledWith('start');
});
test('long interval appears once and terminal statuses remain textual', async () => {
  const values = [
    'PENDING',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ] as const;
  await renderWithProviders(
    view(
      values.map((status, i) =>
        agendaRow(String(i), '2026-09-28T10:00:00Z', '2026-10-06T10:00:00Z', { status }),
      ),
    ),
  );
  expect(screen.getAllByRole('button', { name: /^Turno, Continúa/ })).toHaveLength(6);
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
test('loading/error/retry and empty day are separate supplied states', async () => {
  const retry = jest.fn(),
    props = { civilDate: '2026-10-02', appointments: [], onSelectAppointment: select };
  const { rerender } = await renderWithProviders(<AgendaDayView {...props} loading />);
  expect(screen.getByText('Cargando turnos del día…')).toBeTruthy();
  expect(screen.queryByText('No hay turnos visibles en este día')).toBeNull();
  await rerender(
    <AgendaDayView {...props} error="No se pudo consultar la agenda." onRetry={retry} />,
  );
  expect(screen.getByText('No se pudo consultar la agenda.')).toBeTruthy();
  expect(screen.queryByText('No hay turnos visibles en este día')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await rerender(view());
  expect(screen.getByText('No hay turnos visibles en este día')).toBeTruthy();
});
test('invalid date/zone fail safely without device fallback', async () => {
  const { rerender } = await renderWithProviders(view([], '2026-02-30'));
  expect(screen.getByText('El día de la agenda no es válido.')).toBeTruthy();
  agendaContext({ timezone: 'bad/zone' });
  await rerender(view());
  expect(screen.getByText('La zona horaria del negocio no está disponible.')).toBeTruthy();
});
test('shared guard rejects obsolete day callbacks', async () => {
  const { result, rerender } = await renderHook<
    ReturnType<typeof useAgendaPresentation>,
    { date: string }
  >(({ date }) => useAgendaPresentation(date), { initialProps: { date: '2026-10-01' } });
  const old = result.current.isCurrent;
  await rerender({ date: '2026-10-02' });
  expect(old()).toBe(false);
  expect(result.current.isCurrent()).toBe(true);
});
test('actual BF146 uses one business-day range across DST', async () => {
  agendaContext({ timezone: 'America/New_York' });
  await renderWithProviders(<Reader civilDate="2026-03-08" />);
  await screen.findByRole('heading', { name: /domingo, 8 de marzo de 2026/ });
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1);
  expect(appointmentsService.listByRange).toHaveBeenCalledWith('b', {
    from: '2026-03-08T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  });
});
test.each(['user', 'business', 'membership', 'role', 'logout', 'timezone'])(
  'BF146 rejects late previous %s result before day presentation',
  async (mode) => {
    let resolve!: (v: { data: AppointmentRow[]; error: null }) => void;
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
