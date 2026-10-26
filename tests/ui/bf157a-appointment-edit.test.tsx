import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import EditRoute from '@/app/(app)/appointments/[id]/edit';
import { AppointmentActions } from '@/features/appointments/components/AppointmentActions';
import { AppointmentEditScreen } from '@/features/appointments/screens/AppointmentEditScreen';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import type {
  AppointmentDetail,
  AppointmentStatus,
} from '@/features/appointments/types/appointment.types';
import { businessDirectoryService } from '@/features/business/services/businessDirectoryService';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useLocalSearchParams: jest.fn(),
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: {
    getById: jest.fn(),
    updateNotes: jest.fn(),
    reschedule: jest.fn(),
    changeStatus: jest.fn(),
    getAvailability: jest.fn(),
  },
}));
jest.mock('@/features/business/services/businessDirectoryService', () => ({
  businessDirectoryService: { listWorkingMembers: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw Error('UI may not use Supabase directly');
});

let stored: AppointmentDetail;
const slot = {
  start_at: '2026-10-05T10:00:00.000000Z',
  end_at: '2026-10-05T11:00:00Z',
  available: true,
};
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  resetRouterMocks();
  jest.clearAllMocks();
  stored = {
    ...agendaRow('a', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
    notes: null,
    appointment_services: [],
  };
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'a' });
  jest
    .mocked(appointmentsService.getById)
    .mockImplementation(async () => ({ data: stored, error: null }));
  jest.mocked(appointmentsService.updateNotes).mockImplementation(async (_b, input) => {
    stored = { ...stored, notes: input.notes };
    return { data: stored, error: null };
  });
  jest.mocked(appointmentsService.reschedule).mockImplementation(async (_b, input) => {
    stored = {
      ...stored,
      start_at: input.startAt,
      end_at: slot.end_at,
      barber_member_id: input.barberMemberId,
    };
    return { data: stored, error: null };
  });
  jest.mocked(appointmentsService.changeStatus).mockImplementation(async (_b, input) => {
    stored = { ...stored, status: input.status };
    return { data: stored, error: null };
  });
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({ data: [slot], error: null });
  jest.mocked(businessDirectoryService.listWorkingMembers).mockResolvedValue({
    data: [
      { id: 'm', role: 'OWNER', is_active: true },
      { id: 'other', role: 'BARBER', is_active: true },
    ],
    error: null,
  });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

test.each(['PENDING', 'CONFIRMED', 'IN_PROGRESS'] as AppointmentStatus[])(
  'OWNER can manage %s, no manual COMPLETED action',
  async (status) => {
    stored.status = status;
    await renderWithProviders(<AppointmentActions appointment={stored} />);
    expect(screen.getByRole('button', { name: 'Editar cita' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar cita' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marcar no asistió' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Completar/ })).toBeNull();
    expect(appointmentsService.changeStatus).not.toHaveBeenCalled();
  },
);
test.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as AppointmentStatus[])(
  'terminal %s has no destructive/edit affordance',
  async (status) => {
    stored.status = status;
    await renderWithProviders(<AppointmentActions appointment={stored} />);
    expect(screen.queryByRole('button')).toBeNull();
  },
);

test('BF167 reschedule conflict leaves original appointment intact, refreshes own-excluded availability and explicitly recovers', async () => {
  const original = { ...stored };
  jest.mocked(appointmentsService.reschedule).mockResolvedValueOnce({
    data: null,
    error: { code: 'APPOINTMENT_CONFLICT', message: 'other-client-private' },
  });
  await renderWithProviders(<EditRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Reprogramar cita' }));
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
  const next = { ...slot, start_at: '2026-10-05T12:00:00Z', end_at: '2026-10-05T13:00:00Z' };
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [{ ...slot, available: false }, next], error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar reprogramación' }));
  await screen.findByText('El horario solicitado no está disponible. Selecciona otro horario.');
  await screen.findByText('Sin horario seleccionado');
  expect(stored).toEqual(original);
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.queryByText('other-client-private')).toBeNull();
  expect(appointmentsService.reschedule).toHaveBeenCalledTimes(1);
  expect(appointmentsService.getAvailability).toHaveBeenLastCalledWith(
    'b',
    expect.objectContaining({ excludeAppointmentId: 'a', durationMinutes: 60 }),
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: /Horario:.*12:00:00.*Disponible/ }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar reprogramación' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  expect(jest.mocked(appointmentsService.reschedule).mock.calls[1][1].startAt).toBe(next.start_at);
});
test('BARBER assigned allowed, foreign assignment and business denied', async () => {
  agendaContext({ role: 'BARBER' });
  const ui = await renderWithProviders(<AppointmentActions appointment={stored} />);
  expect(screen.getByRole('button', { name: 'Editar cita' })).toBeTruthy();
  await ui.rerender(<AppointmentActions appointment={{ ...stored, barber_member_id: 'other' }} />);
  expect(screen.queryByRole('button')).toBeNull();
  await ui.rerender(<AppointmentActions appointment={{ ...stored, business_id: 'foreign' }} />);
  expect(screen.queryByRole('button')).toBeNull();
});
test.each([
  ['Cancelar cita', 'CANCELLED'],
  ['Marcar no asistió', 'NO_SHOW'],
] as const)(
  '%s requires confirmation and dispatches exactly one existing mutation',
  async (label, status) => {
    await renderWithProviders(<AppointmentActions appointment={stored} />);
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(appointmentsService.changeStatus).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar cambio de estado' }));
    await screen.findByText('Estado de la cita actualizado.');
    expect(appointmentsService.changeStatus).toHaveBeenCalledTimes(1);
    expect(appointmentsService.changeStatus).toHaveBeenCalledWith('b', {
      appointmentId: 'a',
      status,
    });
  },
);
test('closing confirmation performs no mutation; edit opens owned route', async () => {
  await renderWithProviders(<AppointmentActions appointment={stored} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar cita' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Volver sin cambios' }));
  expect(appointmentsService.changeStatus).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Editar cita' }));
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/appointments/[id]/edit',
    params: { id: 'a' },
  });
});
test('notes preserve null until edited, send only notes DTO, replace with updated detail', async () => {
  await renderWithProviders(<EditRoute />);
  await screen.findByLabelText('Notas');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/appointments/[id]',
      params: { id: 'a' },
    }),
  );
  expect(appointmentsService.updateNotes).toHaveBeenCalledWith('b', {
    appointmentId: 'a',
    notes: null,
  });
});
test('notes error is safe, preserves exact text and allows explicit retry', async () => {
  jest.mocked(appointmentsService.updateNotes).mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'private SQL' },
  });
  await renderWithProviders(<EditRoute />);
  await fireEvent.changeText(await screen.findByLabelText('Notas'), '  texto original  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('private SQL')).toBeNull();
  expect(screen.getByLabelText('Notas').props.value).toBe('  texto original  ');
  expect(routerMock.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await waitFor(() => expect(appointmentsService.updateNotes).toHaveBeenCalledTimes(2));
});
test('reschedule reuses availability with exclusion and persisted duration; sends exact slot start, no snapshots', async () => {
  await renderWithProviders(<EditRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Reprogramar cita' }));
  await waitFor(() =>
    expect(appointmentsService.getAvailability).toHaveBeenCalledWith('b', {
      barberMemberId: 'm',
      date: '2026-10-01',
      durationMinutes: 60,
      excludeAppointmentId: 'a',
    }),
  );
  await fireEvent.changeText(screen.getByLabelText('Fecha del turno (YYYY-MM-DD)'), '2026-10-05');
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar reprogramación' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  expect(appointmentsService.reschedule).toHaveBeenCalledWith('b', {
    appointmentId: 'a',
    barberMemberId: 'm',
    startAt: slot.start_at,
    durationOverride: undefined,
  });
  expect(appointmentsService.updateNotes).not.toHaveBeenCalled();
});
test('date, duration and professional edits reset the selected slot', async () => {
  await renderWithProviders(<EditRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Reprogramar cita' }));
  for (const change of [
    async () =>
      fireEvent.changeText(screen.getByLabelText('Fecha del turno (YYYY-MM-DD)'), '2026-10-05'),
    async () =>
      fireEvent.changeText(screen.getByLabelText('Nueva duración opcional (minutos)'), '45'),
    async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Seleccionar profesional: Barbero 2' })),
  ]) {
    await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
    await change();
    await screen.findByText('Sin horario seleccionado');
    expect(appointmentsService.reschedule).not.toHaveBeenCalled();
  }
});
test('BARBER cannot override duration or choose a foreign professional', async () => {
  agendaContext({ role: 'BARBER' });
  await renderWithProviders(<EditRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Reprogramar cita' }));
  expect(screen.queryByLabelText('Nueva duración opcional (minutos)')).toBeNull();
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Seleccionar profesional: Barbero 2' }),
  );
  expect(appointmentsService.getAvailability).not.toHaveBeenCalledWith(
    'b',
    expect.objectContaining({ barberMemberId: 'other' }),
  );
});
test.each([undefined, ['a', 'b'], '   '])(
  'invalid route %j performs no detail/write',
  async (id) => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ id } as ReturnType<typeof useLocalSearchParams>);
    await renderWithProviders(<EditRoute />);
    expect(appointmentsService.getById).not.toHaveBeenCalled();
    expect(appointmentsService.reschedule).not.toHaveBeenCalled();
  },
);
test('pending notes blocks repeat submit/cancel/mode switch; late completion after context change cannot navigate', async () => {
  let finish!: (v: Awaited<ReturnType<typeof appointmentsService.updateNotes>>) => void;
  jest.mocked(appointmentsService.updateNotes).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const ui = await renderWithProviders(<EditRoute />);
  await screen.findByLabelText('Notas');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Volver sin guardar' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Reprogramar cita' }));
  expect(appointmentsService.updateNotes).toHaveBeenCalledTimes(1);
  expect(routerMock.back).not.toHaveBeenCalled();
  agendaContext({ businessId: 'new' });
  await ui.rerender(<EditRoute />);
  await act(() => finish({ data: stored, error: null }));
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('conflict preserves reschedule intent and does not navigate', async () => {
  jest.mocked(appointmentsService.reschedule).mockResolvedValue({
    data: null,
    error: { code: 'APPOINTMENT_CONFLICT', message: 'private details' },
  });
  await renderWithProviders(<AppointmentEditScreen appointmentId="a" />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Reprogramar cita' }));
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar reprogramación' }));
  await screen.findByText('El horario solicitado no está disponible. Selecciona otro horario.');
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.queryByText('private details')).toBeNull();
});

test('confirmed notes write remains success when read refresh fails', async () => {
  const ui = await renderWithProviders(<EditRoute />);
  await screen.findByLabelText('Notas');
  jest.spyOn(ui.queryClient, 'invalidateQueries').mockRejectedValueOnce(Error('refresh failed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/appointments/[id]',
      params: { id: 'a' },
    }),
  );
  expect(appointmentsService.updateNotes).toHaveBeenCalledTimes(1);
});

test('active detail refetch failure cannot unmount and misclassify the confirmed write', async () => {
  await renderWithProviders(<EditRoute />);
  await screen.findByLabelText('Notas');
  jest.mocked(appointmentsService.getById).mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'private read error' },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar notas' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/appointments/[id]',
      params: { id: 'a' },
    }),
  );
  expect(appointmentsService.updateNotes).toHaveBeenCalledTimes(1);
});

test('status pending blocks contradictory actions and repeated confirmation', async () => {
  let finish!: (v: Awaited<ReturnType<typeof appointmentsService.changeStatus>>) => void;
  jest.mocked(appointmentsService.changeStatus).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await renderWithProviders(<AppointmentActions appointment={stored} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar cita' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirmar cambio de estado' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirmar cambio de estado' }));
  expect(appointmentsService.changeStatus).toHaveBeenCalledTimes(1);
  await act(() => finish({ data: { ...stored, status: 'CANCELLED' }, error: null }));
  await screen.findByText('Estado de la cita actualizado.');
});

test.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as AppointmentStatus[])(
  'edit route rejects terminal %s before rendering form',
  async (status) => {
    stored.status = status;
    await renderWithProviders(<EditRoute />);
    await screen.findByText('Esta cita no permite edición');
    expect(screen.queryByLabelText('Notas')).toBeNull();
  },
);
