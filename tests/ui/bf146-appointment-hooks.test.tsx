import type { Session } from '@supabase/supabase-js';
import {
  defaultScheduler,
  notifyManager,
  onlineManager,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { appointmentsKeys as keys } from '@/features/appointments/constants/appointmentsKeys';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { useAvailability } from '@/features/appointments/hooks/useAvailability';
import { useCreateAppointment } from '@/features/appointments/hooks/useCreateAppointment';
import { useRescheduleAppointment } from '@/features/appointments/hooks/useRescheduleAppointment';
import { useUpdateAppointmentNotes } from '@/features/appointments/hooks/useUpdateAppointmentNotes';
import { useAppointmentStatusAction } from '@/features/appointments/hooks/useAppointmentStatusAction';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { mapAppointmentError } from '@/features/appointments/services/appointmentErrors';
import type {
  AppointmentDetail,
  AppointmentRow,
} from '@/features/appointments/types/appointment.types';
import { createTestQueryClient } from '@/test/createTestQueryClient';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: {
    listByRange: jest.fn(),
    getById: jest.fn(),
    getAvailability: jest.fn(),
    create: jest.fn(),
    reschedule: jest.fn(),
    updateNotes: jest.fn(),
    changeStatus: jest.fn(),
  },
}));
const service = jest.mocked(appointmentsService);
const at = '2026-10-22T09:00:00Z';
const range = { from: at, to: '2026-10-22T18:00:00Z' };
const slot = {
  barberMemberId: 'm',
  date: '2026-10-22',
  durationMinutes: 30,
  excludeAppointmentId: 'a',
};
const scope = { businessId: 'b', userId: 'u', membershipId: 'm', role: 'OWNER' as const };
const row = (id = 'a'): AppointmentRow => ({
  id,
  business_id: 'b',
  client_id: 'c',
  barber_member_id: 'm',
  start_at: at,
  end_at: '2026-10-22T09:30:00Z',
  status: 'PENDING',
  notes: null,
  created_by: 'u',
  created_at: at,
  updated_at: at,
});
const detail = (): AppointmentDetail => ({ ...row(), appointment_services: [] });
const reschedule = () => ({ appointmentId: 'a', barberMemberId: 'm', startAt: at });
function context(b = 'b', u = 'u', m = 'm', role: 'OWNER' | 'BARBER' = 'OWNER') {
  const session: Session = {
    access_token: 'test-only',
    refresh_token: 'test-only',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: u, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: at },
  };
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'authenticated', session, user: session.user, error: null });
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId: m,
      role,
      business: { id: b, name: 'Test', currency_code: 'ARS', timezone: 'UTC', is_active: true },
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function mount<T>(
  hook: () => T,
  configure?: (client: ReturnType<typeof createTestQueryClient>) => void,
) {
  const client = createTestQueryClient();
  configure?.(client);
  let value!: T;
  function Probe() {
    value = hook();
    return null;
  }
  const element = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const view = await render(element());
  return {
    client,
    get hook() {
      return value;
    },
    rerender: () => view.rerender(element()),
    unmount: () => view.unmount(),
  };
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  onlineManager.setOnline(true);
  context();
  jest.mocked(useIsFocused).mockReturnValue(true);
  service.listByRange.mockResolvedValue({ data: [row()], error: null });
  service.getById.mockResolvedValue({ data: detail(), error: null });
  service.getAvailability.mockResolvedValue({
    data: [{ start_at: at, end_at: row().end_at, available: true }],
    error: null,
  });
  service.create.mockResolvedValue({ data: detail(), error: null });
  for (const op of [service.reschedule, service.updateNotes, service.changeStatus])
    op.mockResolvedValue({ data: row(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
});

test('range read returns rows/empty and delegates exact endpoints', async () => {
  const h = await mount(() => useAppointments(range));
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(service.listByRange).toHaveBeenCalledWith('b', range);
  service.listByRange.mockResolvedValue({ data: [], error: null });
  await act(async () => h.hook.refetch());
  expect(h.hook.data).toEqual([]);
});
test('detail keeps snapshots and changes query identity with appointment id', async () => {
  let id = 'a';
  const h = await mount(() => useAppointmentDetail(id));
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(h.hook.data?.appointment_services).toEqual([]);
  id = 'other';
  await h.rerender();
  await waitFor(() => expect(service.getById).toHaveBeenCalledWith('b', 'other'));
});
test('availability delegates all parameters and hides old slots on changes', async () => {
  let input = slot;
  const h = await mount(() => useAvailability(input));
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(service.getAvailability).toHaveBeenCalledWith('b', slot);
  const d = deferred<Awaited<ReturnType<typeof appointmentsService.getAvailability>>>();
  service.getAvailability.mockReturnValueOnce(d.promise);
  input = { ...slot, durationMinutes: 45 };
  await h.rerender();
  expect(h.hook.data).toBeNull();
  await act(async () => d.resolve({ data: [], error: null }));
  await waitFor(() => expect(h.hook.data).toEqual([]));
});
test('invalid query inputs do not call services even on refetch', async () => {
  const h = await mount(() => ({
    list: useAppointments({ from: at, to: at }),
    detail: useAppointmentDetail(' '),
    availability: useAvailability({ ...slot, date: '2026-02-30' }),
  }));
  for (const value of Object.values(h.hook)) {
    expect(value.status).toBe('error');
    await act(async () => value.refetch());
  }
  expect(service.listByRange).not.toHaveBeenCalled();
  expect(service.getById).not.toHaveBeenCalled();
  expect(service.getAvailability).not.toHaveBeenCalled();
});
test('reads keep safe service error and disable automatic retries', async () => {
  service.listByRange.mockResolvedValue({
    data: null,
    error: mapAppointmentError('NETWORK_ERROR')!,
  });
  const h = await mount(() => useAppointments(range));
  await waitFor(() => expect(h.hook.status).toBe('error'));
  expect(h.hook.error?.code).toBe('NETWORK_ERROR');
  expect(service.listByRange).toHaveBeenCalledTimes(1);
});
test('create keeps requestId, strips managed input and preserves nested intent', async () => {
  const h = await mount(() => useCreateAppointment());
  const input = {
    requestId: 'op',
    clientId: 'c',
    barberMemberId: 'm',
    startAt: at,
    items: [{ serviceId: 's', quantity: 2 }],
    notes: '  original  ',
    business_id: 'foreign',
    status: 'COMPLETED',
  };
  await act(async () => {
    await h.hook.mutateAsync(input);
  });
  expect(service.create).toHaveBeenCalledWith('b', {
    requestId: 'op',
    clientId: 'c',
    barberMemberId: 'm',
    startAt: at,
    items: [{ serviceId: 's', quantity: 2 }],
    notes: '  original  ',
  });
  expect(h.hook.data?.appointment_services).toEqual([]);
});
test('reschedule success uses frozen DTO without client transition checks', async () => {
  const h = await mount(() => useRescheduleAppointment());
  await act(async () => {
    await h.hook.mutateAsync(reschedule());
  });
  expect(h.hook.status).toBe('success');
  expect(service.reschedule).toHaveBeenCalledWith('b', reschedule());
});
test.each([null, '', '  untouched  '])('notes success preserves %p', async (notes) => {
  const h = await mount(() => useUpdateAppointmentNotes());
  await act(async () => {
    await h.hook.mutateAsync({ appointmentId: 'a', notes });
  });
  expect(service.updateNotes).toHaveBeenCalledWith('b', { appointmentId: 'a', notes });
  expect(h.hook.status).toBe('success');
});
test('BARBER may request operation; backend decides assignment and terminal transitions', async () => {
  context('b', 'u', 'm', 'BARBER');
  const h = await mount(() => useAppointmentStatusAction());
  await act(async () => {
    await h.hook.mutateAsync({ appointmentId: 'other-assignment', status: 'IN_PROGRESS' });
  });
  expect(service.changeStatus).toHaveBeenCalledWith('b', {
    appointmentId: 'other-assignment',
    status: 'IN_PROGRESS',
  });
});
test('terminal/conflict service error propagated safely without writes retried', async () => {
  service.changeStatus.mockResolvedValue({
    data: null,
    error: mapAppointmentError({ code: 'PT409', message: 'private SQL internals' })!,
  });
  const h = await mount(() => useAppointmentStatusAction());
  await act(async () => {
    await expect(
      h.hook.mutateAsync({ appointmentId: 'a', status: 'CANCELLED' }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFLICT' });
  });
  expect(h.hook.error?.message).not.toContain('private');
  expect(service.changeStatus).toHaveBeenCalledTimes(1);
});
test('unexpected rejection becomes safe unknown error', async () => {
  service.reschedule.mockRejectedValue(new Error('raw SQL stack secret'));
  const h = await mount(() => useRescheduleAppointment());
  await act(async () => {
    await expect(h.hook.mutateAsync(reschedule())).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });
  expect(h.hook.error?.message).not.toContain('SQL');
});
test('pending double-submit and reset cannot change current intent', async () => {
  const d = deferred<Awaited<ReturnType<typeof appointmentsService.reschedule>>>();
  service.reschedule.mockReturnValueOnce(d.promise);
  const h = await mount(() => useRescheduleAppointment());
  let first!: Promise<AppointmentRow>;
  let second!: Promise<AppointmentRow>;
  await act(async () => {
    first = h.hook.mutateAsync(reschedule());
    h.hook.reset();
    second = h.hook.mutateAsync({ ...reschedule(), startAt: '2026-10-22T12:00:00Z' });
  });
  expect(first).toBe(second);
  expect(service.reschedule).toHaveBeenCalledTimes(1);
  await act(async () => {
    d.resolve({ data: row(), error: null });
    await first;
  });
  await act(async () => {
    await h.hook.retry();
  });
  expect(service.reschedule).toHaveBeenCalledTimes(1);
});
test('explicit retry after failure keeps same intent; changed intent requires reset', async () => {
  service.reschedule.mockResolvedValueOnce({
    data: null,
    error: mapAppointmentError('NETWORK_ERROR')!,
  });
  const h = await mount(() => useRescheduleAppointment());
  await act(async () => {
    await h.hook.mutateAsync(reschedule()).catch(() => {});
  });
  expect(service.reschedule).toHaveBeenCalledTimes(1);
  await act(async () => {
    await h.hook.retry();
  });
  expect(service.reschedule).toHaveBeenCalledTimes(2);
  await expect(h.hook.mutateAsync({ ...reschedule(), durationOverride: 60 })).rejects.toMatchObject(
    { code: 'INVALID_APPOINTMENT' },
  );
  await act(async () => h.hook.reset());
  await act(async () => {
    await h.hook.mutateAsync({ ...reschedule(), durationOverride: 60 });
  });
  expect(service.reschedule).toHaveBeenCalledTimes(3);
});
test('refresh failure preserves confirmed success; retryReads never writes', async () => {
  const h = await mount(() => useRescheduleAppointment());
  const invalidate = jest
    .spyOn(h.client, 'invalidateQueries')
    .mockRejectedValueOnce(new Error('refresh failed'));
  await act(async () => {
    await expect(h.hook.mutateAsync(reschedule())).resolves.toMatchObject({ id: 'a' });
  });
  expect(h.hook.status).toBe('success');
  expect(h.hook.refreshError).toBe(true);
  invalidate.mockResolvedValueOnce();
  await act(async () => h.hook.retryReads());
  expect(h.hook.refreshError).toBe(false);
  expect(service.reschedule).toHaveBeenCalledTimes(1);
});
test.each(['notes', 'status'] as const)(
  '%s invalidates only actual current appointment scopes',
  async (kind) => {
    const h = await mount(() => ({
      notes: useUpdateAppointmentNotes(),
      status: useAppointmentStatusAction(),
    }));
    const targets = {
      list: keys.list(scope, range),
      detail: keys.detail(scope, 'a'),
      otherDetail: keys.detail(scope, 'other'),
      slots: keys.availability(scope, slot),
      otherUser: keys.list({ ...scope, userId: 'other' }, range),
      otherBusiness: keys.list({ ...scope, businessId: 'other' }, range),
      product: ['products', 'b'],
    };
    for (const key of Object.values(targets)) h.client.setQueryData(key, []);
    await act(async () => {
      if (kind === 'notes') await h.hook.notes.mutateAsync({ appointmentId: 'a', notes: null });
      else await h.hook.status.mutateAsync({ appointmentId: 'a', status: 'CONFIRMED' });
    });
    for (const [name, key] of Object.entries(targets))
      expect(h.client.getQueryState(key)?.isInvalidated).toBe(
        ['list', 'detail', ...(kind === 'status' ? ['slots'] : [])].includes(name),
      );
  },
);
for (const change of [
  'logout',
  'business',
  'membership',
  'user',
  'role',
  'blur',
  'unmount',
] as const) {
  test(`pending mutation ignores late success after ${change}`, async () => {
    const d = deferred<Awaited<ReturnType<typeof appointmentsService.reschedule>>>();
    service.reschedule.mockReturnValueOnce(d.promise);
    const h = await mount(() => useRescheduleAppointment());
    const invalidate = jest.spyOn(h.client, 'invalidateQueries');
    let promise!: Promise<AppointmentRow>;
    await act(async () => {
      promise = h.hook.mutateAsync(reschedule());
    });
    const observed = promise.catch((error) => error);
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (change === 'business') context('new');
    if (change === 'membership') context('b', 'u', 'new');
    if (change === 'user') context('b', 'new');
    if (change === 'role') context('b', 'u', 'm', 'BARBER');
    if (change === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    if (change === 'unmount') await h.unmount();
    else await h.rerender();
    await act(async () => d.resolve({ data: row(), error: null }));
    await expect(observed).resolves.toMatchObject({ code: 'APPOINTMENT_ACCESS_DENIED' });
    expect(invalidate).not.toHaveBeenCalled();
    if (change !== 'unmount') expect(h.hook.status).toBe('idle');
  });
}
test('old read does not populate cache after context A-B-A', async () => {
  const d = deferred<Awaited<ReturnType<typeof appointmentsService.listByRange>>>();
  service.listByRange.mockReturnValueOnce(d.promise);
  const h = await mount(() => useAppointments(range));
  context('other');
  await h.rerender();
  context();
  await h.rerender();
  await act(async () => d.resolve({ data: [row('stale')], error: null }));
  await waitFor(() => expect(h.hook.data?.[0]?.id).not.toBe('stale'));
});
test('missing context prevents all writes and manual read refetch', async () => {
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
  const h = await mount(() => ({
    query: useAppointments(range),
    mutation: useRescheduleAppointment(),
  }));
  expect(h.hook.query.status).toBe('idle');
  await act(async () => h.hook.query.refetch());
  await expect(h.hook.mutation.mutateAsync(reschedule())).rejects.toMatchObject({
    code: 'APPOINTMENT_ACCESS_DENIED',
  });
  expect(service.listByRange).not.toHaveBeenCalled();
  expect(service.reschedule).not.toHaveBeenCalled();
});

test('operational mutation overrides global automatic retry and does not pause offline', async () => {
  onlineManager.setOnline(false);
  service.reschedule.mockResolvedValue({
    data: null,
    error: mapAppointmentError('NETWORK_ERROR')!,
  });
  const h = await mount(
    () => useRescheduleAppointment(),
    (client) =>
      client.setDefaultOptions({
        ...client.getDefaultOptions(),
        mutations: { ...client.getDefaultOptions().mutations, retry: 2, retryDelay: 0 },
      }),
  );
  await act(async () => {
    await expect(h.hook.mutateAsync(reschedule())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  expect(service.reschedule).toHaveBeenCalledTimes(1);
  expect(h.hook.status).toBe('error');
  onlineManager.setOnline(true);
  await h.rerender();
  expect(service.reschedule).toHaveBeenCalledTimes(1);
});
