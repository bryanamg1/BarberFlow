import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { useMemo } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useAgendaPresentation } from '@/features/appointments/components/AgendaPresentation';
import { AgendaWeekView } from '@/features/appointments/components/AgendaWeekView';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { agendaWeek } from '@/features/appointments/utils/agendaCalendar';
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
  throw new Error('No week SDK or mutations');
});
const selectDate = jest.fn(),
  selectAppointment = jest.fn();
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T01:00:00Z'));
  jest.mocked(appointmentsService.listByRange).mockResolvedValue({ data: [], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const view = (appointments: AppointmentRow[] = [], civilWeekStart = '2026-09-28') => (
  <AgendaWeekView
    civilWeekStart={civilWeekStart}
    appointments={appointments}
    selectedDate="2026-10-01"
    onSelectDate={selectDate}
    onSelectAppointment={selectAppointment}
  />
);
// Composition belongs to BF155. This harness exercises the actual BF146 reader only.
function Reader({ civilWeekStart = '2026-09-28' }: { civilWeekStart?: string }) {
  const business = useBusiness();
  const timezone = business.status === 'success' ? business.data.business.timezone : 'UTC';
  const range = useMemo(
    () => agendaWeek(civilWeekStart, timezone).range,
    [civilWeekStart, timezone],
  );
  const result = useAppointments(range);
  return (
    <AgendaWeekView
      civilWeekStart={civilWeekStart}
      appointments={result.status === 'success' ? result.data : []}
      loading={result.status === 'pending' || result.isFetching}
      error={result.error?.message}
      onSelectDate={selectDate}
      onSelectAppointment={selectAppointment}
    />
  );
}

test('seven accessible civil days span Monday to Sunday, with controlled selection and business today', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  await renderWithProviders(view());
  expect(
    screen.getByRole('heading', { name: 'Semana del lunes, 28 de septiembre de 2026' }),
  ).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /0 turnos visibles/ })).toHaveLength(7);
  expect(screen.getByRole('button', { name: /domingo, 4 de octubre de 2026/ })).toBeTruthy();
  const selected = screen.getByRole('button', { name: /jueves, 1 de octubre de 2026, Hoy/ });
  expect(selected.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(selected);
  expect(selectDate).toHaveBeenCalledWith('2026-10-01');
  expect(screen.queryByRole('button', { name: /Anterior|Siguiente/ })).toBeNull();
});

test('controlled week changes cross the year without normalizing to a different week', async () => {
  const { rerender } = await renderWithProviders(view([], '2026-12-28'));
  expect(screen.getByRole('button', { name: /domingo, 3 de enero de 2027/ })).toBeTruthy();
  await rerender(view([], '2027-01-04'));
  expect(screen.getByRole('button', { name: /lunes, 4 de enero de 2027/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /28 de diciembre/ })).toBeNull();
});

test('cross-midnight entries preserve the real range, continuation text and original selection ID', async () => {
  await renderWithProviders(view([agendaRow()]));
  const entries = screen.getAllByRole('button', { name: /^Turno,/ });
  expect(entries).toHaveLength(2);
  expect(entries[0].props.accessibilityLabel).toContain('23:30');
  expect(entries[1].props.accessibilityLabel).toContain('Continúa');
  expect(entries[1].props.accessibilityLabel).toContain('00:30');
  for (const entry of entries) await fireEvent.press(entry);
  expect(selectAppointment.mock.calls).toEqual([['a'], ['a']]);
});

test('an interval covering the week has seven representations, not seven domain records', async () => {
  const row = Object.freeze(agendaRow('long', '2026-09-27T23:00:00Z', '2026-10-06T01:00:00Z'));
  await renderWithProviders(view([row, row]));
  const entries = screen.getAllByRole('button', { name: /^Turno, Continúa/ });
  expect(entries).toHaveLength(7);
  await fireEvent.press(entries[0]);
  await fireEvent.press(entries[6]);
  expect(selectAppointment.mock.calls).toEqual([['long'], ['long']]);
  expect(row.start_at).toBe('2026-09-27T23:00:00Z');
  expect(row.end_at).toBe('2026-10-06T01:00:00Z');
});

test('exact midnight end and next week start never create phantom days', async () => {
  await renderWithProviders(
    view([
      agendaRow('end', '2026-10-04T23:00:00Z', '2026-10-05T00:00:00Z'),
      agendaRow('outside', '2026-10-05T00:00:00Z', '2026-10-05T01:00:00Z'),
    ]),
  );
  expect(screen.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /^Turno, Continúa/ })).toBeNull();
});

test('same-day entries use deterministic start/id order and keep semantic statuses', async () => {
  await renderWithProviders(
    view([
      agendaRow('b', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', { status: 'CANCELLED' }),
      agendaRow('z', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', { status: 'COMPLETED' }),
      agendaRow('a', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', { status: 'NO_SHOW' }),
    ]),
  );
  const entries = screen.getAllByRole('button', { name: /^Turno,/ });
  expect(entries.map((entry) => entry.props.accessibilityLabel)).toEqual([
    expect.stringContaining('Completada'),
    expect.stringContaining('No asistió'),
    expect.stringContaining('Cancelada'),
  ]);
  for (const entry of entries) await fireEvent.press(entry);
  expect(selectAppointment.mock.calls).toEqual([['z'], ['a'], ['b']]);
});

test('loading and error do not masquerade as empty week or individual empty days', async () => {
  const retry = jest.fn();
  const props = {
    civilWeekStart: '2026-09-28',
    appointments: [],
    onSelectDate: selectDate,
    onSelectAppointment: selectAppointment,
  };
  const { rerender } = await renderWithProviders(<AgendaWeekView {...props} loading />);
  expect(screen.getByText('Cargando turnos de la semana…')).toBeTruthy();
  expect(screen.queryByText('No hay turnos visibles en esta semana')).toBeNull();
  await rerender(
    <AgendaWeekView {...props} error="No se pudo consultar la agenda." onRetry={retry} />,
  );
  expect(screen.queryByText('Sin turnos visibles este día')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await rerender(<AgendaWeekView {...props} />);
  expect(screen.getByText('No hay turnos visibles en esta semana')).toBeTruthy();
  expect(screen.getAllByText('Sin turnos visibles este día')).toHaveLength(7);
});

test('non-Monday input and invalid timezone fail safely without guessing', async () => {
  const { rerender } = await renderWithProviders(view([], '2026-09-29'));
  expect(screen.getByText('La semana de la agenda debe comenzar un lunes válido.')).toBeTruthy();
  agendaContext({ timezone: 'bad/zone' });
  await rerender(view());
  expect(screen.getByText('La zona horaria del negocio no está disponible.')).toBeTruthy();
});

test('obsolete week lifecycle guard becomes inactive on a controlled period change', async () => {
  const { result, rerender } = await renderHook<
    ReturnType<typeof useAgendaPresentation>,
    { week: string }
  >(({ week }) => useAgendaPresentation(week), { initialProps: { week: '2026-09-28' } });
  const old = result.current.isCurrent;
  await rerender({ week: '2026-10-05' });
  expect(old()).toBe(false);
  expect(result.current.isCurrent()).toBe(true);
});

test('actual BF146 reader requests one DST-aware week, never one query per day', async () => {
  agendaContext({ timezone: 'America/New_York' });
  await renderWithProviders(<Reader civilWeekStart="2026-03-02" />);
  await screen.findByRole('heading', { name: /Semana del lunes, 2 de marzo de 2026/ });
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(1);
  expect(appointmentsService.listByRange).toHaveBeenCalledWith('b', {
    from: '2026-03-02T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  });
});

test.each(['user', 'business', 'membership', 'role', 'logout', 'timezone'])(
  'BF146 rejects a late previous %s result before weekly rendering',
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
