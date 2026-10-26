import { act } from '@testing-library/react-native';
import { isCancelledError } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAppointmentConflictRecovery } from '@/features/appointments/hooks/useAppointmentConflictRecovery';
import { renderWithProviders } from '@/test/renderWithProviders';
import { agendaContext } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
const input = { date: '2026-11-01', barberMemberId: 'm', durationMinutes: 30 };
let recovery: ReturnType<typeof useAppointmentConflictRecovery>;
function Harness({ loading = false, timezone = 'UTC' }: { loading?: boolean; timezone?: string }) {
  const value = useAppointmentConflictRecovery(loading ? null : input, timezone, 'same-raw-inputs');
  useLayoutEffect(() => {
    recovery = value;
  });
  return null;
}
beforeEach(() => agendaContext());

test('BF167 marks only exact user/business/membership/role/parameters/timezone availability stale, no broad clear or reader', async () => {
  const ui = await renderWithProviders(<Harness />);
  const scope = { businessId: 'b', membershipId: 'm', userId: 'u', role: 'OWNER' };
  const key = [
    'appointments',
    'b',
    scope,
    'availability',
    { ...input, excludeAppointmentId: undefined },
    'UTC',
  ];
  const unrelated = [
    'appointments',
    'b',
    scope,
    'availability',
    { ...input, date: '2026-11-02' },
    'UTC',
  ];
  ui.queryClient.setQueryData(key, []);
  ui.queryClient.setQueryData(unrelated, []);
  const cancel = jest.spyOn(ui.queryClient, 'cancelQueries');
  const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
  await act(() => recovery.recover());
  expect(cancel).toHaveBeenCalledWith({ queryKey: key, exact: true });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true, refetchType: 'none' });
  expect(ui.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  expect(ui.queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(recovery.conflicted).toBe(true);
});
test.each(['user', 'business', 'membership', 'role', 'timezone', 'logout'])(
  'BF167 late conflict/retry callback cannot invalidate after %s change',
  async (change) => {
    const ui = await renderWithProviders(<Harness />);
    const old = recovery;
    const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
    if (change === 'user') agendaContext({ userId: 'other' });
    if (change === 'business') agendaContext({ businessId: 'other' });
    if (change === 'membership') agendaContext({ membershipId: 'other' });
    if (change === 'role') agendaContext({ role: 'BARBER' });
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await ui.rerender(<Harness timezone={change === 'timezone' ? 'America/New_York' : 'UTC'} />);
    await act(async () => {
      await old.recover();
      await old.retryReads();
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(recovery.conflicted).toBe(false);
  },
);
test('BF167 invalidation failure is controlled and can retry reads without any write', async () => {
  const ui = await renderWithProviders(<Harness />);
  const invalidate = jest
    .spyOn(ui.queryClient, 'invalidateQueries')
    .mockRejectedValueOnce(Error('private'));
  await act(() => recovery.recover());
  expect(recovery.refreshError).toBe(true);
  await act(() => recovery.retryReads());
  expect(recovery.refreshError).toBe(false);
  expect(invalidate).toHaveBeenCalledTimes(2);
});

test('BF167 feedback survives transient loading of derived duration for unchanged raw controls', async () => {
  const ui = await renderWithProviders(<Harness />);
  await act(() => recovery.recover());
  await ui.rerender(<Harness loading />);
  expect(recovery.conflicted).toBe(true);
  await ui.rerender(<Harness />);
  expect(recovery.conflicted).toBe(true);
  await act(() => recovery.reset());
  expect(recovery.conflicted).toBe(false);
});

test('BF167 old in-flight availability response cannot make the rejected dataset fresh again', async () => {
  const ui = await renderWithProviders(<Harness />);
  const key = [
    'appointments',
    'b',
    { businessId: 'b', membershipId: 'm', userId: 'u', role: 'OWNER' },
    'availability',
    { ...input, excludeAppointmentId: undefined },
    'UTC',
  ];
  ui.queryClient.setQueryData(key, []);
  const staleRows = [
    { start_at: '2026-11-01T10:00:00Z', end_at: '2026-11-01T10:30:00Z', available: true },
  ];
  let finish!: (value: typeof staleRows) => void;
  const old = ui.queryClient
    .fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: () =>
        new Promise<typeof staleRows>((resolve) => {
          finish = resolve;
        }),
    })
    .catch((reason) => {
      expect(isCancelledError(reason)).toBe(true);
    });
  await act(() => recovery.recover());
  finish(staleRows);
  await old;
  expect(ui.queryClient.getQueryData(key)).toEqual([]);
  expect(ui.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
});
