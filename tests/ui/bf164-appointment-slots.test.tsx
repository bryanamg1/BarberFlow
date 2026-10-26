import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useIsFocused } from 'expo-router';

import * as ButtonPrimitive from '@/components/ui/Button';
import {
  AppointmentSlotSelector,
  type AppointmentSlotSelectorProps,
} from '@/features/appointments/components/AppointmentSlotSelector';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import type { AppointmentAvailabilitySlot } from '@/features/appointments/types/appointment.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { renderWithProviders } from '@/test/renderWithProviders';
import { agendaContext } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { getAvailability: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No UI SDK bypass');
});

const first: AppointmentAvailabilitySlot = {
  start_at: '2026-10-23T09:00:00Z',
  end_at: '2026-10-23T09:30:00Z',
  available: true,
};
const second: AppointmentAvailabilitySlot = {
  start_at: '2026-10-23T09:15:00Z',
  end_at: '2026-10-23T09:45:00Z',
  available: false,
};
const third: AppointmentAvailabilitySlot = {
  start_at: '2026-10-23T09:30:00Z',
  end_at: '2026-10-23T10:00:00Z',
  available: true,
};
type Params = Omit<AppointmentSlotSelectorProps, 'value' | 'onChange'>;
const params: Params = { date: '2026-10-23', duration: 30, barberMemberId: 'm' };
const change = jest.fn();
function Controlled({
  initial = null,
  ...input
}: Partial<Params> & { initial?: AppointmentAvailabilitySlot | null }) {
  const [value, setValue] = useState(initial);
  return (
    <AppointmentSlotSelector
      {...params}
      {...input}
      value={value}
      onChange={(slot) => {
        change(slot);
        setValue(slot);
      }}
    />
  );
}
function pending() {
  let resolve!: (value: Awaited<ReturnType<typeof appointmentsService.getAvailability>>) => void;
  const promise = new Promise<Awaited<ReturnType<typeof appointmentsService.getAvailability>>>(
    (done) => {
      resolve = done;
    },
  );
  return { resolve, promise };
}
const buttons = () => screen.getAllByRole('button', { name: /^Horario:/ });
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  change.mockReset();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [third, second, first], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
test('one existing BF146 read, exact date/member/duration; sorted real rows, unavailable disabled, controlled exact selection', async () => {
  await renderWithProviders(<Controlled />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  const choices = buttons();
  expect(choices).toHaveLength(3);
  expect(choices[0].props.accessibilityLabel).toMatch(/09:00:00/);
  expect(choices[1].props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(choices[1]);
  expect(change).not.toHaveBeenCalled();
  await fireEvent.press(choices[0]);
  expect(change).toHaveBeenLastCalledWith(first);
  expect(change.mock.calls.at(-1)![0]).toBe(first);
  expect(screen.getByRole('status').props.children).toMatch(/Horario seleccionado:.*09:00:00/);
  expect(buttons()[0].props.accessibilityState.selected).toBe(true);
  expect(appointmentsService.getAvailability).toHaveBeenCalledTimes(1);
  expect(appointmentsService.getAvailability).toHaveBeenCalledWith('b', {
    date: '2026-10-23',
    durationMinutes: 30,
    barberMemberId: 'm',
  });
  expect(Object.keys(appointmentsService)).toEqual(['getAvailability']);
});
test('existing optional exclusion is forwarded, no reschedule or catalog/member lookups', async () => {
  await renderWithProviders(<Controlled excludeAppointmentId="a" />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  expect(appointmentsService.getAvailability).toHaveBeenCalledWith('b', {
    date: '2026-10-23',
    durationMinutes: 30,
    barberMemberId: 'm',
    excludeAppointmentId: 'a',
  });
});
test('Web exposes pressed selection and disabled unavailable state through existing buttons', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await renderWithProviders(<Controlled />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  expect(buttons()[0].props['aria-pressed']).toBe(false);
  expect(buttons()[1].props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(buttons()[0]);
  expect(buttons()[0].props['aria-pressed']).toBe(true);
});
test.each<Partial<Params>>([
  { date: '' },
  { date: '2026-02-30' },
  { date: '0000-01-01' },
  { duration: null },
  { duration: 0 },
  { duration: -1 },
  { duration: 1.5 },
  { barberMemberId: null },
  { barberMemberId: '  ' },
])(
  'incomplete/invalid inputs %j have no availability call or fabricated empty result',
  async (input) => {
    await renderWithProviders(<Controlled {...input} />);
    expect(
      screen.getByText('Selecciona fecha, profesional y duración para consultar horarios'),
    ).toBeTruthy();
    expect(appointmentsService.getAvailability).not.toHaveBeenCalled();
  },
);
test('loading, safe error, explicit retry and empty are distinct', async () => {
  const deferred = pending();
  jest.mocked(appointmentsService.getAvailability).mockReturnValueOnce(deferred.promise);
  await renderWithProviders(<Controlled />);
  expect(screen.getByText('Consultando horarios…')).toBeTruthy();
  expect(screen.queryByText('No hay horarios disponibles para esta fecha y duración')).toBeNull();
  await act(() =>
    deferred.resolve({
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'private SQL detail' },
    }),
  );
  await screen.findByRole('button', { name: 'Reintentar' });
  expect(screen.queryByText('private SQL detail')).toBeNull();
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({ data: [], error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('No hay horarios disponibles para esta fecha y duración');
  expect(appointmentsService.getAvailability).toHaveBeenCalledTimes(2);
});
test('all-conflicting candidates stay visible and disabled, without inventing why a day is empty', async () => {
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [second], error: null });
  await renderWithProviders(<Controlled />);
  await screen.findByText('No hay horarios disponibles para esta fecha y duración');
  expect(buttons()).toHaveLength(1);
  expect(buttons()[0].props.accessibilityState.disabled).toBe(true);
});
test.each<Partial<Params>>([
  { date: '2026-10-24' },
  { duration: 45 },
  { barberMemberId: 'other-member' },
  { excludeAppointmentId: 'a' },
])('changing params %j clears selection, uses new RPC input, never auto-selects', async (next) => {
  const { rerender } = await renderWithProviders(<Controlled initial={first} />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  expect(screen.getByRole('status').props.children).toMatch(/Horario seleccionado/);
  change.mockReset();
  await rerender(<Controlled initial={first} {...next} />);
  await screen.findByText('Sin horario seleccionado');
  expect(change).toHaveBeenCalledWith(null);
  expect(appointmentsService.getAvailability).toHaveBeenLastCalledWith(
    'b',
    expect.objectContaining({
      date: next.date ?? params.date,
      durationMinutes: next.duration ?? params.duration,
      barberMemberId: next.barberMemberId ?? params.barberMemberId,
    }),
  );
});
test('refresh disabling an existing selected interval clears it without choosing another', async () => {
  const { queryClient } = await renderWithProviders(<Controlled initial={first} />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [{ ...first, available: false }, third], error: null });
  await act(() => queryClient.invalidateQueries({ queryKey: ['appointments'] }));
  await screen.findByText('Sin horario seleccionado');
  expect(change).toHaveBeenCalledWith(null);
});
test('captured old slot cannot select while refetch is pending or after logout', async () => {
  const ActualButton = ButtonPrimitive.Button;
  const spy = jest
    .spyOn(ButtonPrimitive, 'Button')
    .mockImplementation((props) => <ActualButton {...props} />);
  const { queryClient, rerender } = await renderWithProviders(<Controlled />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  const oldPress = spy.mock.calls.find(
    ([p]) => p.accessibilityLabel?.startsWith('Horario:') && p.label.includes('09:00:00'),
  )![0].onPress!;
  const deferred = pending();
  jest.mocked(appointmentsService.getAvailability).mockReturnValueOnce(deferred.promise);
  await act(() => {
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
  });
  await screen.findByText('Consultando horarios…');
  await act(() => oldPress({} as never));
  expect(change).not.toHaveBeenCalled();
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await rerender(<Controlled />);
  await act(() => oldPress({} as never));
  expect(change).not.toHaveBeenCalled();
  await act(() => deferred.resolve({ data: [first], error: null }));
  expect(screen.queryByRole('button', { name: /^Horario:/ })).toBeNull();
});
test.each(['user', 'business', 'membership', 'role', 'timezone', 'logout', 'blur'])(
  'context %s clears old selection and ignores late availability',
  async (mode) => {
    const { rerender } = await renderWithProviders(<Controlled initial={first} />);
    await screen.findByRole('heading', { name: 'Horarios disponibles' });
    if (mode === 'user') agendaContext({ userId: 'new-u' });
    if (mode === 'business') agendaContext({ businessId: 'new-b' });
    if (mode === 'membership') agendaContext({ membershipId: 'new-m' });
    if (mode === 'role') agendaContext({ role: 'BARBER' });
    if (mode === 'timezone') agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (mode === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    const deferred = pending();
    jest.mocked(appointmentsService.getAvailability).mockReturnValueOnce(deferred.promise);
    change.mockReset();
    await rerender(<Controlled initial={first} />);
    expect(change).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('button', { name: /^Horario:/ })).toBeNull();
    if (!['logout', 'blur'].includes(mode)) {
      await waitFor(() => expect(appointmentsService.getAvailability).toHaveBeenCalledTimes(2));
      await act(() => deferred.resolve({ data: [first], error: null }));
      await screen.findByText('Sin horario seleccionado');
    }
  },
);
test('A→B→A ignores the old success/error and accepts only latest successful parameter set', async () => {
  const old = pending();
  jest.mocked(appointmentsService.getAvailability).mockReturnValueOnce(old.promise);
  const { rerender } = await renderWithProviders(<Controlled />);
  await waitFor(() => expect(appointmentsService.getAvailability).toHaveBeenCalledTimes(1));
  const middle = pending();
  jest.mocked(appointmentsService.getAvailability).mockReturnValueOnce(middle.promise);
  await rerender(<Controlled duration={45} />);
  await waitFor(() => expect(appointmentsService.getAvailability).toHaveBeenCalledTimes(2));
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [third], error: null });
  await rerender(<Controlled />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  await act(() => old.resolve({ data: [first], error: null }));
  await act(() =>
    middle.resolve({ data: null, error: { code: 'NETWORK_ERROR', message: 'private' } }),
  );
  expect(buttons()).toHaveLength(1);
  expect(buttons()[0].props.accessibilityLabel).toMatch(/09:30:00/);
  await fireEvent.press(buttons()[0]);
  expect(change).toHaveBeenLastCalledWith(third);
});
test('BARBER cannot query a different calendar; OWNER forwards a selected target for authoritative RPC validation', async () => {
  agendaContext({ role: 'BARBER' });
  const { rerender } = await renderWithProviders(<Controlled barberMemberId="foreign" />);
  expect(screen.getByText('No se pudo acceder a esta agenda.')).toBeTruthy();
  expect(appointmentsService.getAvailability).not.toHaveBeenCalled();
  agendaContext({ role: 'OWNER' });
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({
    data: null,
    error: { code: 'APPOINTMENT_ACCESS_DENIED', message: 'foreign business identity' },
  });
  await rerender(<Controlled barberMemberId="foreign" />);
  await screen.findByRole('button', { name: 'Reintentar' });
  expect(screen.queryByText('foreign business identity')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Horario:/ })).toBeNull();
});
test('business timezone formats endpoints across civil days; no device fallback or future-only filtering', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  const old = { start_at: '2000-01-02T02:30:00Z', end_at: '2000-01-02T04:30:00Z', available: true };
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({ data: [old], error: null });
  await renderWithProviders(<Controlled date="2000-01-01" />);
  await screen.findByRole('heading', { name: 'Horarios disponibles' });
  expect(buttons()[0].props.accessibilityLabel).toMatch(
    /01\/01\/2000.*23:30:00.*02\/01\/2000.*01:30:00/,
  );
  await fireEvent.press(buttons()[0]);
  expect(change).toHaveBeenLastCalledWith(old);
});
test('invalid timezone and pending business do not perform a query', async () => {
  agendaContext({ timezone: 'bad/zone' });
  const { rerender } = await renderWithProviders(<Controlled />);
  expect(screen.getByText('La zona horaria del negocio no está disponible.')).toBeTruthy();
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  await rerender(<Controlled />);
  expect(screen.getByText('Cargando negocio…')).toBeTruthy();
  expect(appointmentsService.getAvailability).not.toHaveBeenCalled();
});
test('malformed availability is a safe error, not empty or selectable', async () => {
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [{ ...first, end_at: first.start_at }], error: null });
  await renderWithProviders(<Controlled initial={first} />);
  await screen.findByText('No se pudieron leer los horarios disponibles.');
  expect(screen.queryByRole('button', { name: /^Horario:/ })).toBeNull();
  expect(change).toHaveBeenCalledWith(null);
});
