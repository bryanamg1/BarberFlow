import { View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  QueryClientProvider,
  notifyManager,
  defaultScheduler,
  onlineManager,
} from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';

import { HomeTodayAppointments } from '@/features/analytics/components/HomeTodayAppointments';
import { AppointmentCard } from '@/features/appointments/components/AppointmentCard';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn(), useRouter: jest.fn() }));
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { listByRange: jest.fn() },
}));
jest.mock('@/features/appointments/components/AppointmentCard', () => {
  const actual = jest.requireActual('@/features/appointments/components/AppointmentCard');
  return { ...actual, AppointmentCard: jest.fn(actual.AppointmentCard) };
});
jest.mock('@/features/analytics/hooks/useNextAppointment', () => {
  throw new Error('Today must not consume Next');
});
const list = jest.mocked(appointmentsService.listByRange),
  push = jest.fn();
const item = () => agendaRow('today', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z');
beforeEach(() => {
  jest
    .mocked(AppointmentCard)
    .mockImplementation(
      jest.requireActual('@/features/appointments/components/AppointmentCard').AppointmentCard,
    );
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T12:00:00Z'));
  notifyManager.setScheduler(queueMicrotask);
  onlineManager.setOnline(true);
  list.mockResolvedValue({ data: [item()], error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
  jest.useRealTimers();
});
async function mount(width = 375) {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: Infinity } });
  const element = () => (
    <QueryClientProvider client={client}>
      <View style={{ width }}>
        <HomeTodayAppointments />
      </View>
    </QueryClientProvider>
  );
  const ui = await render(element());
  return { client, ui, update: () => ui.rerender(element()) };
}
test('BF262 OWNER uses one existing range query and exact AppointmentCard identity', async () => {
  const data = item();
  list.mockResolvedValue({ data: [data], error: null });
  const h = await mount();
  await waitFor(() => expect(h.ui.getByRole('button', { name: /^Turno,/ })).toBeTruthy());
  expect(list).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledWith('b', {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
  });
  expect(jest.mocked(AppointmentCard).mock.calls.at(-1)![0].appointment).toBe(data);
  h.client.clear();
});
test.each([
  ['PENDING', 'Pendiente'],
  ['CONFIRMED', 'Confirmada'],
  ['IN_PROGRESS', 'En curso'],
  ['COMPLETED', 'Completada'],
  ['CANCELLED', 'Cancelada'],
  ['NO_SHOW', 'No asistió'],
] as const)('BF262 keeps past-today %s and its accessible textual state', async (status, label) => {
  list.mockResolvedValue({
    data: [agendaRow('past', '2026-10-01T00:01:00Z', '2026-10-01T00:02:00Z', { status })],
    error: null,
  });
  const h = await mount();
  await waitFor(() => expect(h.ui.getByRole('button', { name: new RegExp(label) })).toBeTruthy());
  h.client.clear();
});
test('BF262 loading never presents an empty collection', async () => {
  list.mockImplementation(() => new Promise(() => {}));
  const h = await mount();
  expect(h.ui.getByText('Cargando turnos del día…')).toBeTruthy();
  expect(h.ui.queryByText('No hay turnos visibles en este día')).toBeNull();
  h.client.clear();
});
test('BF262 safe error remains error and read-only retry uses existing hook', async () => {
  list.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'provider secret' },
  });
  const h = await mount();
  await waitFor(() =>
    expect(
      h.ui.getByText('No se pudo conectar con el servicio. Inténtalo nuevamente.'),
    ).toBeTruthy(),
  );
  expect(h.ui.queryByText('No hay turnos visibles en este día')).toBeNull();
  expect(JSON.stringify(h.ui.toJSON())).not.toContain('provider secret');
  await fireEvent.press(h.ui.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(h.ui.getByRole('button', { name: /^Turno,/ })).toBeTruthy());
  h.client.clear();
});
test('BF262 genuine empty is distinct from unavailable', async () => {
  list.mockResolvedValue({ data: [], error: null });
  const h = await mount();
  await waitFor(() => expect(h.ui.getByText('No hay turnos visibles en este día')).toBeTruthy());
  expect(h.ui.queryByText('Agenda no disponible')).toBeNull();
  h.client.clear();
});
test.each([
  'unauthenticated',
  'business-pending',
  'business-error',
  'invalid-timezone',
  'blurred',
] as const)('BF262 unavailable context %s never fetches', async (guard) => {
  if (guard === 'unauthenticated')
    jest
      .mocked(useAuth)
      .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  else if (guard === 'blurred') jest.mocked(useIsFocused).mockReturnValue(false);
  else if (guard === 'invalid-timezone') agendaContext({ timezone: 'Invalid/Timezone' });
  else {
    const b = useBusiness();
    jest.mocked(useBusiness).mockReturnValue({
      ...b,
      status: guard === 'business-pending' ? 'pending' : 'error',
    } as ReturnType<typeof useBusiness>);
  }
  const h = await mount();
  expect(list).not.toHaveBeenCalled();
  expect(h.ui.queryByRole('button', { name: /^Turno,/ })).toBeNull();
  h.client.clear();
});
test('BF262 BARBER renders only assigned rows with existing role/context guard', async () => {
  agendaContext({ role: 'BARBER' });
  list.mockResolvedValue({
    data: [item(), { ...item(), id: 'other', barber_member_id: 'other-member' }],
    error: null,
  });
  const h = await mount();
  await waitFor(() => expect(h.ui.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(1));
  expect(jest.mocked(AppointmentCard).mock.calls.at(-1)![0].appointment.id).toBe('today');
  h.client.clear();
});
test('BF262 exact boundaries exclude touching nonintersections and keep continuation identity', async () => {
  const continued = agendaRow('continued', '2026-09-30T23:00:00Z', '2026-10-01T01:00:00Z');
  list.mockResolvedValue({
    data: [
      agendaRow('end', '2026-09-30T23:00:00Z', '2026-10-01T00:00:00Z'),
      continued,
      agendaRow('upper', '2026-10-02T00:00:00Z', '2026-10-02T01:00:00Z'),
    ],
    error: null,
  });
  const h = await mount();
  await waitFor(() => expect(h.ui.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(1));
  expect(h.ui.getByRole('button', { name: /Continúa/ })).toBeTruthy();
  expect(jest.mocked(AppointmentCard).mock.calls.at(-1)![0].appointment).toBe(continued);
  h.client.clear();
});
test('BF262 reader order is preserved even when inputs are intentionally unordered', async () => {
  list.mockResolvedValue({
    data: [
      { ...item(), id: 'z', status: 'CONFIRMED' },
      { ...item(), id: 'a', status: 'PENDING' },
    ],
    error: null,
  });
  const h = await mount();
  await waitFor(() => expect(h.ui.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(2));
  const cards = jest.mocked(AppointmentCard).mock.calls.slice(-2);
  expect(cards.map(([props]) => props.appointment.id)).toEqual(['z', 'a']);
  h.client.clear();
});
test('BF262 existing navigation opens detail; retained callback cannot cross business context', async () => {
  const h = await mount();
  await waitFor(() => expect(h.ui.getByRole('button', { name: /^Turno,/ })).toBeTruthy());
  const retained = jest.mocked(AppointmentCard).mock.calls.at(-1)![0].onPress!;
  await fireEvent.press(h.ui.getByRole('button', { name: /^Turno,/ }));
  expect(push).toHaveBeenCalledWith({ pathname: '/appointments/[id]', params: { id: 'today' } });
  agendaContext({ businessId: 'new' });
  list.mockResolvedValue({ data: [], error: null });
  await h.update();
  retained();
  expect(push).toHaveBeenCalledTimes(1);
  h.client.clear();
});
test('BF262 pending response from old business cannot populate the new list', async () => {
  let finish!: (value: Awaited<ReturnType<typeof appointmentsService.listByRange>>) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const h = await mount();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  agendaContext({ businessId: 'new' });
  list.mockResolvedValue({ data: [], error: null });
  await h.update();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await act(() => finish({ data: [item()], error: null }));
  await waitFor(() => expect(h.ui.getByText('No hay turnos visibles en este día')).toBeTruthy());
  expect(h.ui.queryByRole('button', { name: /^Turno,/ })).toBeNull();
  h.client.clear();
});
test.each([
  ['2026-03-08T12:00:00Z', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
  ['2026-11-01T12:00:00Z', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
])('BF262 DST day %s reaches existing query with real civil endpoints', async (now, from, to) => {
  agendaContext({ timezone: 'America/New_York' });
  jest.mocked(Date.now).mockReturnValue(Date.parse(now));
  list.mockResolvedValue({ data: [], error: null });
  const h = await mount();
  await waitFor(() => expect(list).toHaveBeenCalledWith('b', { from, to }));
  h.client.clear();
});
test('BF262 business midnight reuses existing clock and issues the new day range', async () => {
  jest.useFakeTimers({ now: Date.parse('2026-10-01T23:59:00Z'), doNotFake: ['queueMicrotask'] });
  list.mockResolvedValue({ data: [], error: null });
  const h = await mount();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  jest.setSystemTime(new Date('2026-10-02T00:00:10Z'));
  await act(() => jest.advanceTimersByTime(60_000));
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith('b', {
      from: '2026-10-02T00:00:00.000Z',
      to: '2026-10-03T00:00:00.000Z',
    }),
  );
  h.client.clear();
  await h.ui.unmount();
});
test.each([375, 1440])('BF262 accessible card and heading at width %i', async (width) => {
  const h = await mount(width);
  await waitFor(() => expect(h.ui.getByRole('button', { name: /^Turno,/ })).toBeTruthy());
  expect(h.ui.getByRole('heading', { name: 'jueves, 1 de octubre de 2026' })).toBeTruthy();
  h.client.clear();
});
