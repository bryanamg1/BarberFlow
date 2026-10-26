import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import AppointmentRoute from '@/app/(app)/appointments/[id]';
import * as ButtonPrimitive from '@/components/ui/Button';
import { AppointmentDetailScreen } from '@/features/appointments/screens/AppointmentDetailScreen';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import type {
  AppointmentDetail,
  AppointmentStatus,
} from '@/features/appointments/types/appointment.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { businessDirectoryService } from '@/features/business/services/businessDirectoryService';
import { clientsService } from '@/features/clients/services/clientsService';
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
  appointmentsService: { getById: jest.fn() },
}));
jest.mock('@/features/clients/services/clientsService', () => ({
  clientsService: { getById: jest.fn() },
}));
jest.mock('@/features/business/services/businessDirectoryService', () => ({
  businessDirectoryService: { listWorkingMembers: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('UI cannot bypass repository');
});

function detail(extra: Partial<AppointmentDetail> = {}): AppointmentDetail {
  return {
    ...agendaRow(),
    notes: 'Texto histórico <script>no ejecutar</script>',
    appointment_services: [
      {
        id: 'line',
        appointment_id: 'a',
        service_id: null,
        service_name_snapshot: 'Corte histórico archivado',
        unit_price_snapshot: 10000,
        quantity: 2,
        duration_minutes_snapshot: 30,
        line_total: 20000,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    ...extra,
  };
}
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
  is_active: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  resetRouterMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'a' });
  jest.mocked(appointmentsService.getById).mockResolvedValue({ data: detail(), error: null });
  jest.mocked(clientsService.getById).mockResolvedValue({ data: client, error: null });
  jest.mocked(businessDirectoryService.listWorkingMembers).mockResolvedValue({
    data: [
      { id: 'm', role: 'OWNER', is_active: true },
      { id: 'z', role: 'BARBER', is_active: true },
    ],
    error: null,
  });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
test('real existing route → scoped detail reader, client and D08 directory, persisted snapshots, no N+1', async () => {
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Cliente: Martín Pérez');
  expect(screen.getByRole('heading', { name: 'Detalle de cita' })).toBeTruthy();
  expect(screen.getByText('Profesional: Yo')).toBeTruthy();
  expect(screen.getByText('Corte histórico archivado')).toBeTruthy();
  expect(screen.getByText('Cantidad: 2')).toBeTruthy();
  expect(screen.getByText('Duración unitaria histórica: 30 minutos')).toBeTruthy();
  expect(screen.getByText(/Precio unitario histórico:.*10\.000,00/)).toBeTruthy();
  expect(screen.getByText(/Importe registrado:.*20\.000,00/)).toBeTruthy();
  expect(screen.getByText('Notas: Texto histórico <script>no ejecutar</script>')).toBeTruthy();
  expect(appointmentsService.getById).toHaveBeenCalledTimes(1);
  expect(appointmentsService.getById).toHaveBeenCalledWith('b', 'a');
  expect(clientsService.getById).toHaveBeenCalledTimes(1);
  expect(clientsService.getById).toHaveBeenCalledWith('b', 'c');
  expect(businessDirectoryService.listWorkingMembers).toHaveBeenCalledTimes(1);
  expect(businessDirectoryService.listWorkingMembers).toHaveBeenCalledWith('b', undefined);
  await fireEvent.press(screen.getByRole('button', { name: 'Ir al checkout de esta cita' }));
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/sales/new',
    params: { appointmentId: 'a' },
  });
  expect(Object.keys(appointmentsService)).toEqual(['getById']);
});
test.each<[AppointmentStatus, string, boolean]>([
  ['PENDING', 'Pendiente', true],
  ['CONFIRMED', 'Confirmada', true],
  ['IN_PROGRESS', 'En curso', true],
  ['COMPLETED', 'Completada', false],
  ['CANCELLED', 'Cancelada', false],
  ['NO_SHOW', 'No asistió', false],
])(
  'canonical %s is textual; checkout affordance is navigation only',
  async (status, label, checkout) => {
    jest
      .mocked(appointmentsService.getById)
      .mockResolvedValue({ data: detail({ status }), error: null });
    await renderWithProviders(<AppointmentRoute />);
    await screen.findByText(`Estado: ${label}`);
    expect(Boolean(screen.queryByRole('button', { name: 'Ir al checkout de esta cita' }))).toBe(
      checkout,
    );
    expect(Boolean(screen.queryByRole('button', { name: 'Editar cita' }))).toBe(checkout);
    expect(Boolean(screen.queryByRole('button', { name: 'Cancelar cita' }))).toBe(checkout);
    for (const name of ['Editar', 'Reprogramar', 'No asistió', 'Iniciar cita', 'Completar cita'])
      expect(screen.queryByRole('button', { name })).toBeNull();
  },
);
test('business timezone shows both real endpoints across dates, independent of device zone', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  jest.mocked(appointmentsService.getById).mockResolvedValue({
    data: detail({ start_at: '2026-10-02T02:30:00Z', end_at: '2026-10-02T04:30:00Z' }),
    error: null,
  });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText(
    /Fecha y hora \(America\/Argentina\/Buenos_Aires\):.*1\/10\/26, 23:30.*2\/10\/26, 01:30/,
  );
});
test.each([undefined, [], ['a', 'b'], '', '   '])(
  'invalid route %j is safe and performs no reader',
  async (id) => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ id } as ReturnType<typeof useLocalSearchParams>);
    await renderWithProviders(<AppointmentRoute />);
    await screen.findByText('Cita no encontrada');
    expect(appointmentsService.getById).not.toHaveBeenCalled();
    expect(clientsService.getById).not.toHaveBeenCalled();
    expect(businessDirectoryService.listWorkingMembers).not.toHaveBeenCalled();
  },
);
test('loading, controlled query error and explicit retry are distinct from not found', async () => {
  let resolve!: (v: Awaited<ReturnType<typeof appointmentsService.getById>>) => void;
  jest.mocked(appointmentsService.getById).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await renderWithProviders(<AppointmentRoute />);
  expect(screen.getByText('Cargando cita…')).toBeTruthy();
  expect(screen.queryByText('Cita no encontrada')).toBeNull();
  await act(() =>
    resolve({ data: null, error: { code: 'NETWORK_ERROR', message: 'private provider' } }),
  );
  await screen.findByRole('button', { name: 'Reintentar' });
  expect(screen.queryByText('private provider')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Corte histórico archivado');
  expect(appointmentsService.getById).toHaveBeenCalledTimes(2);
});
test('not-found/hidden detail never starts related readers or reveals references', async () => {
  jest.mocked(appointmentsService.getById).mockResolvedValue({
    data: null,
    error: { code: 'APPOINTMENT_NOT_FOUND', message: 'private' },
  });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Cita no encontrada');
  expect(clientsService.getById).not.toHaveBeenCalled();
  expect(businessDirectoryService.listWorkingMembers).not.toHaveBeenCalled();
  expect(screen.queryByText('private')).toBeNull();
});
test.each([{ business_id: 'foreign' }, { id: 'foreign' }])(
  'mismatched row %j is never rendered or enriched',
  async (extra) => {
    jest
      .mocked(appointmentsService.getById)
      .mockResolvedValue({ data: detail(extra), error: null });
    await renderWithProviders(<AppointmentRoute />);
    await screen.findByText('Cita no encontrada');
    expect(screen.queryByText('Corte histórico archivado')).toBeNull();
    expect(clientsService.getById).not.toHaveBeenCalled();
  },
);
test('BARBER directory restricts current membership and cannot navigate checkout', async () => {
  agendaContext({ role: 'BARBER' });
  jest
    .mocked(businessDirectoryService.listWorkingMembers)
    .mockResolvedValue({ data: [{ id: 'm', role: 'BARBER', is_active: true }], error: null });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Profesional: Yo');
  expect(businessDirectoryService.listWorkingMembers).toHaveBeenCalledWith('b', 'm');
  expect(screen.queryByRole('button', { name: 'Ir al checkout de esta cita' })).toBeNull();
});
test('other operational member uses role and stable directory ordinal, not profile/ID as label', async () => {
  jest
    .mocked(appointmentsService.getById)
    .mockResolvedValue({ data: detail({ barber_member_id: 'z' }), error: null });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Profesional: Barbero 2');
});
test('missing/inactive member and invisible client are neutral; notes null, no visible services distinct', async () => {
  jest.mocked(appointmentsService.getById).mockResolvedValue({
    data: detail({ barber_member_id: 'archived', notes: null, appointment_services: [] }),
    error: null,
  });
  jest
    .mocked(clientsService.getById)
    .mockResolvedValue({ data: null, error: { code: 'CLIENT_NOT_FOUND', message: 'invisible' } });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Cliente no disponible');
  await screen.findByText('Profesional: Profesional no disponible');
  expect(screen.getByText('Notas: Sin notas')).toBeTruthy();
  expect(screen.getByText('No hay servicios visibles')).toBeTruthy();
});
test('client failure cannot leak error or foreign client; profession failure is explicit and retryable', async () => {
  jest.mocked(clientsService.getById).mockResolvedValue({
    data: { ...client, business_id: 'foreign', first_name: 'Private' },
    error: null,
  });
  jest
    .mocked(businessDirectoryService.listWorkingMembers)
    .mockResolvedValue({ data: null, error: { code: 'UNKNOWN_ERROR', message: 'private' } });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('No se pudo cargar el profesional.');
  expect(screen.queryByText(/Cliente: Private/)).toBeNull();
  expect(screen.queryByText('private')).toBeNull();
  jest
    .mocked(businessDirectoryService.listWorkingMembers)
    .mockResolvedValue({ data: [{ id: 'm', role: 'OWNER', is_active: true }], error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Profesional: Yo');
});
test.each(['user', 'business', 'membership', 'role', 'logout', 'route', 'timezone'])(
  'late detail is ignored across %s change',
  async (mode) => {
    let resolve!: (v: Awaited<ReturnType<typeof appointmentsService.getById>>) => void;
    jest.mocked(appointmentsService.getById).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { rerender } = await renderWithProviders(<AppointmentDetailScreen appointmentId="a" />);
    await waitFor(() => expect(appointmentsService.getById).toHaveBeenCalledTimes(1));
    if (mode === 'user') agendaContext({ userId: 'new-u' });
    if (mode === 'business') agendaContext({ businessId: 'new-b' });
    if (mode === 'membership') agendaContext({ membershipId: 'new-m' });
    if (mode === 'role') agendaContext({ role: 'BARBER' });
    if (mode === 'timezone') agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    jest
      .mocked(appointmentsService.getById)
      .mockResolvedValue({ data: null, error: { code: 'APPOINTMENT_NOT_FOUND', message: 'safe' } });
    await rerender(<AppointmentDetailScreen appointmentId={mode === 'route' ? 'new-a' : 'a'} />);
    await act(() => resolve({ data: detail(), error: null }));
    expect(screen.queryByText('Corte histórico archivado')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ir al checkout de esta cita' })).toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
  },
);
test('loaded data and captured checkout callbacks disappear/invalidate on logout', async () => {
  const ActualButton = ButtonPrimitive.Button;
  const buttons = jest
    .spyOn(ButtonPrimitive, 'Button')
    .mockImplementation((props) => <ActualButton {...props} />);
  const { rerender } = await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Cliente: Martín Pérez');
  const stalePress = buttons.mock.calls.find(([props]) => props.label === 'Ir a cobrar')![0]
    .onPress!;
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await rerender(<AppointmentRoute />);
  await act(() => stalePress({} as Parameters<typeof stalePress>[0]));
  expect(screen.queryByText('Cliente: Martín Pérez')).toBeNull();
  expect(routerMock.push).not.toHaveBeenCalled();
});
test('multiple snapshots do not cause catalog/service calls or multiple reference reads', async () => {
  const row = detail();
  row.appointment_services.push({ ...row.appointment_services[0], id: 'line2' });
  jest.mocked(appointmentsService.getById).mockResolvedValue({ data: row, error: null });
  await renderWithProviders(<AppointmentRoute />);
  await screen.findByText('Cliente: Martín Pérez');
  expect(screen.getAllByText('Corte histórico archivado')).toHaveLength(2);
  expect(appointmentsService.getById).toHaveBeenCalledTimes(1);
  expect(clientsService.getById).toHaveBeenCalledTimes(1);
  expect(businessDirectoryService.listWorkingMembers).toHaveBeenCalledTimes(1);
});

test.each(['client', 'directory'])(
  'late %s reference cannot leak after business change',
  async (reference) => {
    let resolve!: (value: unknown) => void;
    if (reference === 'client')
      jest.mocked(clientsService.getById).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done as typeof resolve;
        }),
      );
    else
      jest.mocked(businessDirectoryService.listWorkingMembers).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done as typeof resolve;
        }),
      );
    const { rerender } = await renderWithProviders(<AppointmentRoute />);
    await screen.findByText('Corte histórico archivado');
    agendaContext({ businessId: 'new-b' });
    jest
      .mocked(appointmentsService.getById)
      .mockResolvedValue({ data: null, error: { code: 'APPOINTMENT_NOT_FOUND', message: 'safe' } });
    await rerender(<AppointmentRoute />);
    await act(() =>
      resolve(
        reference === 'client'
          ? { data: client, error: null }
          : { data: [{ id: 'm', role: 'OWNER', is_active: true }], error: null },
      ),
    );
    expect(screen.queryByText('Cliente: Martín Pérez')).toBeNull();
    expect(screen.queryByText('Profesional: Yo')).toBeNull();
  },
);
