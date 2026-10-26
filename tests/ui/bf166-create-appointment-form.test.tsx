import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import NewRoute from '@/app/(app)/appointments/new';
import { uuid } from 'expo-modules-core';
import { useAuth } from '@/features/auth/context/AuthContext';
import { businessDirectoryService } from '@/features/business/services/businessDirectoryService';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import { clientsService } from '@/features/clients/services/clientsService';
import { servicesService } from '@/features/services/services/servicesService';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  router: {
    ...jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
    canGoBack: () => false,
  },
}));
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  uuid: { v4: jest.fn(() => '00000000-0000-4000-8000-000000001660') },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { create: jest.fn(), getAvailability: jest.fn() },
}));
jest.mock('@/features/business/services/businessDirectoryService', () => ({
  businessDirectoryService: { listWorkingMembers: jest.fn() },
}));
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: { get: jest.fn() },
}));
jest.mock('@/features/clients/services/clientsService', () => ({
  clientsService: { list: jest.fn(), search: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { list: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw Error('No direct Supabase UI access');
});
const requestId = '00000000-0000-4000-8000-000000001660';
const client = {
  id: 'c',
  business_id: 'b',
  first_name: 'Martín',
  last_name: 'Pérez',
  phone: null,
  email: null,
  instagram: null,
  birth_date: null,
  notes: null,
  preferences: null,
  is_active: true,
  created_at: '',
  updated_at: '',
};
const service = {
  id: 's',
  business_id: 'b',
  name: 'Corte',
  description: null,
  price: 100,
  duration_minutes: 30,
  is_active: true,
  created_at: '',
  updated_at: '',
};
const slot = {
  start_at: '2026-10-05T10:00:00.000001Z',
  end_at: '2026-10-05T10:30:00Z',
  available: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  resetRouterMocks();
  jest.mocked(uuid.v4).mockReturnValue(requestId);
  jest.mocked(clientsService.list).mockResolvedValue({
    data: { items: [client], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  jest.mocked(clientsService.getById).mockResolvedValue({ data: client, error: null });
  jest.mocked(servicesService.list).mockResolvedValue({
    data: { items: [service], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  jest.mocked(servicesService.getById).mockResolvedValue({ data: service, error: null });
  jest.mocked(businessDirectoryService.listWorkingMembers).mockResolvedValue({
    data: [
      { id: 'm', role: 'OWNER', is_active: true },
      { id: 'other', role: 'BARBER', is_active: true },
    ],
    error: null,
  });
  jest.mocked(businessSettingsService.get).mockResolvedValue({
    data: {
      profile: {
        id: 'b',
        name: 'Demo',
        phone: null,
        email: null,
        address: null,
        currency_code: 'ARS',
        timezone: 'UTC',
      },
      preferences: {
        business_id: 'b',
        appointment_interval_minutes: 15,
        default_service_buffer_minutes: 10,
        allow_overlapping_appointments: false,
        low_stock_notifications: true,
      },
    },
    error: null,
  });
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({ data: [slot], error: null });
  jest.mocked(appointmentsService.create).mockImplementation(async (_b, input) => ({
    data: { ...agendaRow(input.requestId, input.startAt, slot.end_at), appointment_services: [] },
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
async function fill() {
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' }),
  );
  await fireEvent.press(await screen.findByRole('button', { name: 'Seleccionar profesional: Yo' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar servicio: Corte' }));
  await fireEvent.changeText(screen.getByLabelText('Fecha del turno (YYYY-MM-DD)'), '2026-10-05');
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
}
test('real route begins with no selections/default status/date/notes; no creation or availability request', async () => {
  await renderWithProviders(<NewRoute />);
  await screen.findByLabelText('Buscar clientes');
  expect(screen.getByLabelText('Fecha del turno (YYYY-MM-DD)').props.value).toBe('');
  expect(screen.getByLabelText('Notas').props.value).toBe('');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  expect(appointmentsService.create).not.toHaveBeenCalled();
  expect(appointmentsService.getAvailability).not.toHaveBeenCalled();
});
test('valid composition derives duration, no exclusion, one exact DTO/mutation and persisted detail replace', async () => {
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Notas'), '  original \n texto  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/appointments/[id]',
      params: { id: requestId },
    }),
  );
  expect(appointmentsService.create).toHaveBeenCalledTimes(1);
  expect(appointmentsService.create).toHaveBeenCalledWith('b', {
    requestId,
    clientId: 'c',
    barberMemberId: 'm',
    items: [{ serviceId: 's', quantity: 1 }],
    startAt: slot.start_at,
    notes: '  original \n texto  ',
  });
  expect(appointmentsService.getAvailability).toHaveBeenCalledWith('b', {
    date: '2026-10-05',
    barberMemberId: 'm',
    durationMinutes: 30,
  });
  expect(clientsService.getById).toHaveBeenCalledTimes(1);
});
test('slot is never auto-selected, changing date clears selection and blocks submit', async () => {
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Fecha del turno (YYYY-MM-DD)'), '2026-10-06');
  await screen.findByText('Sin horario seleccionado');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  expect(appointmentsService.create).not.toHaveBeenCalled();
});
test('professional and services quantity changes reset slot; OWNER explicit duration override is transported', async () => {
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Seleccionar profesional: Barbero 2' }));
  await screen.findByText('Sin horario seleccionado');
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Aumentar cantidad de línea 1' }));
  await screen.findByText('Sin horario seleccionado');
  await screen.findByText('Duración del servicio: 60 minutos');
  await fireEvent.changeText(screen.getByLabelText('Duración personalizada (minutos)'), '45');
  await fireEvent.press(screen.getByRole('button', { name: 'Aplicar duración' }));
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() =>
    expect(appointmentsService.create).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({
        durationOverride: 45,
        barberMemberId: 'other',
        items: [{ serviceId: 's', quantity: 2 }],
      }),
    ),
  );
});
test('BARBER uses own membership only and cannot override duration', async () => {
  agendaContext({ role: 'BARBER' });
  await renderWithProviders(<NewRoute />);
  await fill();
  expect(screen.queryByLabelText('Duración personalizada (minutos)')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Seleccionar profesional: Barbero 2' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() =>
    expect(appointmentsService.create).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ barberMemberId: 'm' }),
    ),
  );
});
test('cross-business client is never selectable or submittable', async () => {
  jest.mocked(clientsService.list).mockResolvedValue({
    data: {
      items: [{ ...client, business_id: 'foreign' }],
      page: 1,
      pageSize: 25,
      hasNextPage: false,
    },
    error: null,
  });
  await renderWithProviders(<NewRoute />);
  await screen.findByText('No hay clientes activos para seleccionar.');
  expect(screen.queryByRole('button', { name: 'Seleccionar cliente: Martín Pérez' })).toBeNull();
  expect(appointmentsService.create).not.toHaveBeenCalled();
});
test('conflict is safe, retains entered fields and permits explicit recovery', async () => {
  jest.mocked(appointmentsService.create).mockResolvedValue({
    data: null,
    error: { code: 'APPOINTMENT_CONFLICT', message: 'SQL secret' },
  });
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Notas'), 'conservar');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await screen.findByText('El horario solicitado no está disponible. Selecciona otro horario.');
  expect(screen.getByLabelText('Notas').props.value).toBe('conservar');
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.queryByText('SQL secret')).toBeNull();
});
test('network uncertain retry uses identical immutable request/key without editing or duplicate automatic write', async () => {
  jest
    .mocked(appointmentsService.create)
    .mockResolvedValueOnce({ data: null, error: { code: 'NETWORK_ERROR', message: 'private' } });
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await screen.findByRole('button', { name: 'Reintentar misma solicitud' });
  expect(appointmentsService.create).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Notas')).toBeNull();
  const captured = jest.mocked(appointmentsService.create).mock.calls[0][1];
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar misma solicitud' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  expect(appointmentsService.create).toHaveBeenCalledTimes(2);
  expect(jest.mocked(appointmentsService.create).mock.calls[1][1]).toEqual(captured);
});
test.each(['user', 'business', 'membership', 'role', 'timezone', 'logout'])(
  'pending creation blocks doubles/cancel, ignores late success after %s switch',
  async (change) => {
    let finish!: (v: Awaited<ReturnType<typeof appointmentsService.create>>) => void;
    jest.mocked(appointmentsService.create).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const ui = await renderWithProviders(<NewRoute />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
    await screen.findByText('Guardando cita…');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar sin guardar' }));
    expect(appointmentsService.create).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
    if (change === 'user') agendaContext({ userId: 'other' });
    if (change === 'business') agendaContext({ businessId: 'other' });
    if (change === 'membership') agendaContext({ membershipId: 'other' });
    if (change === 'role') agendaContext({ role: 'BARBER' });
    if (change === 'timezone') agendaContext({ timezone: 'America/New_York' });
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await ui.rerender(<NewRoute />);
    await act(() =>
      finish({ data: { ...agendaRow(requestId), appointment_services: [] }, error: null }),
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);
test('confirmed create keeps success when refresh rejects; cancel before submit performs safe return only', async () => {
  const ui = await renderWithProviders(<NewRoute />);
  await fill();
  jest
    .spyOn(ui.queryClient, 'invalidateQueries')
    .mockRejectedValueOnce(Error('read refresh failed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/appointments/[id]',
      params: { id: requestId },
    }),
  );
  expect(appointmentsService.create).toHaveBeenCalledTimes(1);
});
test('cancel before submit writes nothing and returns safely to agenda', async () => {
  await renderWithProviders(<NewRoute />);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar sin guardar' }));
  expect(routerMock.replace).toHaveBeenCalledWith('/agenda');
  expect(appointmentsService.create).not.toHaveBeenCalled();
});

test('explicit edit after definitive conflict starts a new request, uncertain retry never does', async () => {
  jest.mocked(appointmentsService.create).mockResolvedValueOnce({
    data: null,
    error: { code: 'APPOINTMENT_CONFLICT', message: 'safe' },
  });
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await screen.findByText('El horario solicitado no está disponible. Selecciona otro horario.');
  jest.mocked(uuid.v4).mockReturnValue('00000000-0000-4000-8000-000000001661');
  await fireEvent.changeText(screen.getByLabelText('Notas'), 'nueva intención');
  // Failed submission remounts the readers; BF164 requires a current slot again.
  await fireEvent.press(await screen.findByRole('button', { name: /Horario:.*Disponible/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Crear cita' }).props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() => expect(appointmentsService.create).toHaveBeenCalledTimes(2));
  expect(jest.mocked(appointmentsService.create).mock.calls[0][1].requestId).toBe(requestId);
  expect(jest.mocked(appointmentsService.create).mock.calls[1][1].requestId).toBe(
    '00000000-0000-4000-8000-000000001661',
  );
});

test.each(['archived', 'foreign'])(
  'selected client becomes %s: no submit using stale valid selection',
  async (state) => {
    jest.mocked(clientsService.getById).mockResolvedValue({
      data: {
        ...client,
        is_active: state !== 'archived',
        business_id: state === 'foreign' ? 'foreign' : 'b',
      },
      error: null,
    });
    await renderWithProviders(<NewRoute />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
    expect(appointmentsService.create).not.toHaveBeenCalled();
  },
);

test('unavailable catalog duration blocks submit, without zero/default duration or extra booking', async () => {
  jest
    .mocked(servicesService.getById)
    .mockResolvedValue({ data: { ...service, is_active: false }, error: null });
  await renderWithProviders(<NewRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar servicio: Corte' }));
  await screen.findByText(
    'No se pudo calcular la duración. Revisa los servicios y la configuración.',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  expect(appointmentsService.create).not.toHaveBeenCalled();
});

test('successful create invalidates existing scoped Agenda, availability and saved detail keys only', async () => {
  const ui = await renderWithProviders(<NewRoute />);
  await fill();
  const invalidation = jest.spyOn(ui.queryClient, 'invalidateQueries');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  const filters = invalidation.mock.calls[0][0]!;
  expect(filters.queryKey).toEqual([
    'appointments',
    'b',
    { businessId: 'b', membershipId: 'm', userId: 'u', role: 'OWNER' },
  ]);
  expect(invalidation).toHaveBeenCalledTimes(1);
});

test('BF167 definitive create conflict clears rejected slot, refreshes only exact availability and recovers with explicit new slot', async () => {
  jest.mocked(appointmentsService.create).mockResolvedValueOnce({
    data: null,
    error: { code: 'APPOINTMENT_CONFLICT', message: 'competing-client-private' },
  });
  const ui = await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Notas'), '  retener notas  ');
  const later = { ...slot, start_at: '2026-10-05T11:00:00Z', end_at: '2026-10-05T11:30:00Z' };
  jest
    .mocked(appointmentsService.getAvailability)
    .mockResolvedValue({ data: [{ ...slot, available: false }, later], error: null });
  const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await screen.findByText('El horario solicitado no está disponible. Selecciona otro horario.');
  await screen.findByText('Sin horario seleccionado');
  expect(screen.getByLabelText('Notas').props.value).toBe('  retener notas  ');
  expect(screen.getByLabelText('Fecha del turno (YYYY-MM-DD)').props.value).toBe('2026-10-05');
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.queryByText('competing-client-private')).toBeNull();
  expect(appointmentsService.create).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: [
      'appointments',
      'b',
      { businessId: 'b', membershipId: 'm', userId: 'u', role: 'OWNER' },
      'availability',
      {
        date: '2026-10-05',
        barberMemberId: 'm',
        durationMinutes: 30,
        excludeAppointmentId: undefined,
      },
      'UTC',
    ],
    exact: true,
    refetchType: 'none',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  expect(appointmentsService.create).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    await screen.findByRole('button', { name: /Horario:.*11:00:00.*Disponible/ }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  expect(jest.mocked(appointmentsService.create).mock.calls[1][1]).toEqual(
    expect.objectContaining({
      startAt: later.start_at,
      clientId: 'c',
      barberMemberId: 'm',
      notes: '  retener notas  ',
      items: [{ serviceId: 's', quantity: 1 }],
    }),
  );
});

test('BF167 failed availability refresh is not empty success; explicit reader retry never retries creation', async () => {
  jest
    .mocked(appointmentsService.create)
    .mockResolvedValue({ data: null, error: { code: 'APPOINTMENT_CONFLICT', message: 'private' } });
  await renderWithProviders(<NewRoute />);
  await fill();
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'private availability' },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cita' }));
  await screen.findByText('El horario solicitado no está disponible. Selecciona otro horario.');
  await screen.findByRole('button', { name: 'Reintentar' });
  expect(screen.queryByText('No hay horarios disponibles para esta fecha y duración')).toBeNull();
  jest.mocked(appointmentsService.getAvailability).mockResolvedValue({ data: [slot], error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('button', { name: /Horario:.*Disponible/ });
  expect(appointmentsService.create).toHaveBeenCalledTimes(1);
});
