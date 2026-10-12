import { act, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import { useClientStats, type UseClientStatsResult } from '@/features/clients/hooks/useClientStats';
import { clientStatsService } from '@/features/clients/services/clientStatsService';
import type { ClientStatsResult } from '@/features/clients/types/clientStats.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { queryClient as applicationQueryClient } from '@/lib/query/client';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/services/clientStatsService', () => ({
  clientStatsService: { getByClient: jest.fn() },
}));
const service = jest.mocked(clientStatsService.getByClient);
let latest: UseClientStatsResult;
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm',
    role,
    business: { id, name: 'B', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const auth = (id = 'u') => ({ status: 'authenticated', user: { id } }) as AuthState;
const success = (amount: string | null = '1.29'): ClientStatsResult => ({
  data: {
    totalAppointments: '1',
    completedVisits: '1',
    noShowCount: '0',
    lastVisitAt: null,
    nextAppointmentAt: null,
    totalSpent: amount,
  },
  error: null,
});
function Probe({ id = 'c' }: { id?: string | null }) {
  latest = useClientStats(id);
  return <Text>{`${latest.status}:${latest.data?.totalSpent ?? 'null'}`}</Text>;
}
function deferred() {
  let resolve!: (result: ClientStatsResult) => void;
  const promise = new Promise<ClientStatsResult>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue(auth());
  jest.mocked(useBusiness).mockReturnValue(business());
  service.mockResolvedValue(success());
});

test('real hook pending→success uses original IDs, retry false and inherits global staleTime', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  const configuredClient = createTestQueryClient();
  configuredClient.setDefaultOptions(applicationQueryClient.getDefaultOptions());
  const { queryClient } = await renderWithProviders(<Probe id=" original c " />, {
    queryClient: configuredClient,
  });
  expect(latest.status).toBe('pending');
  expect(service).toHaveBeenCalledWith('b', ' original c ');
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: clientsKeys.stats('b', ' original c ', 'u', 'OWNER'), exact: true });
  expect(query?.options.retry).toBe(false);
  expect(queryClient.defaultQueryOptions({ queryKey: query!.queryKey }).staleTime).toBe(60_000);
  await act(async () => {
    pending.resolve(success());
  });
  await waitFor(() => expect(latest.status).toBe('success'));
  expect(screen.getByText('success:1.29')).toBeOnTheScreen();
  expect(service).toHaveBeenCalledTimes(1);
});

test.each([null, '', '   '])('invalid client %s is idle without service call', async (id) => {
  await renderWithProviders(<Probe id={id} />);
  expect(latest.status).toBe('idle');
  expect(service).not.toHaveBeenCalled();
});
test.each(['idle', 'pending', 'error', 'invalid-id'])(
  'unavailable business %s is idle',
  async (state) => {
    jest
      .mocked(useBusiness)
      .mockReturnValue(
        state === 'invalid-id'
          ? business(' ')
          : ({ status: state, data: null, error: null, isFetching: false } as BusinessContextValue),
      );
    await renderWithProviders(<Probe />);
    expect(latest.status).toBe('idle');
    expect(service).not.toHaveBeenCalled();
  },
);
test.each(['initializing', 'unauthenticated', 'recovering', 'error'])(
  'auth %s cannot fetch stats',
  async (status) => {
    jest.mocked(useAuth).mockReturnValue({ status, user: null } as AuthState);
    await renderWithProviders(<Probe />);
    expect(latest.status).toBe('idle');
    expect(service).not.toHaveBeenCalled();
  },
);

test.each(['business', 'client', 'user', 'role'])(
  '%s switch hides previous and late OWNER data',
  async (scope) => {
    const old = deferred();
    const next = deferred();
    service.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const render = await renderWithProviders(<Probe />);
    if (scope === 'business') jest.mocked(useBusiness).mockReturnValue(business('b2'));
    if (scope === 'user') jest.mocked(useAuth).mockReturnValue(auth('u2'));
    if (scope === 'role') jest.mocked(useBusiness).mockReturnValue(business('b', 'BARBER'));
    await render.rerender(<Probe id={scope === 'client' ? 'c2' : 'c'} />);
    expect(latest.status).toBe('pending');
    await act(async () => {
      old.resolve(success('999.99'));
    });
    expect(latest.data).toBeNull();
    await act(async () => {
      next.resolve(success(scope === 'role' ? null : '2.29'));
    });
    await waitFor(() => expect(latest.status).toBe('success'));
    expect(latest.data?.totalSpent).toBe(scope === 'role' ? null : '2.29');
  },
);

test('BARBER hook suppresses even anomalous non-null service amount', async () => {
  jest.mocked(useBusiness).mockReturnValue(business('b', 'BARBER'));
  await renderWithProviders(<Probe />);
  await waitFor(() => expect(latest.status).toBe('success'));
  expect(latest.data?.totalSpent).toBeNull();
});

test.each(['business', 'client', 'user', 'role'])(
  'successful old cache is not displayed after %s changes',
  async (scope) => {
    const rendered = await renderWithProviders(<Probe />);
    await waitFor(() => expect(latest.status).toBe('success'));
    const next = deferred();
    service.mockReturnValue(next.promise);
    if (scope === 'business') jest.mocked(useBusiness).mockReturnValue(business('b2'));
    if (scope === 'user') jest.mocked(useAuth).mockReturnValue(auth('u2'));
    if (scope === 'role') jest.mocked(useBusiness).mockReturnValue(business('b', 'BARBER'));
    await rendered.rerender(<Probe id={scope === 'client' ? 'c2' : 'c'} />);
    expect(latest.status).toBe('pending');
    expect(latest.data).toBeNull();
    expect(screen.queryByText('success:1.29')).toBeNull();
    await act(async () => {
      next.resolve(success(null));
    });
    await waitFor(() => expect(latest.status).toBe('success'));
  },
);

test('refetch error exposes safe failure without stale financial data or automatic retry', async () => {
  const rendered = await renderWithProviders(<Probe />);
  await waitFor(() => expect(latest.status).toBe('success'));
  service.mockResolvedValue({
    data: null,
    error: { code: 'CLIENT_ACCESS_DENIED', message: 'No se pudo acceder al cliente.' },
  });
  await act(async () => {
    await rendered.queryClient.invalidateQueries({
      queryKey: clientsKeys.stats('b', 'c', 'u', 'OWNER'),
      exact: true,
    });
  });
  await waitFor(() => expect(latest.status).toBe('error'));
  expect(latest.data).toBeNull();
  expect(latest.error?.code).toBe('CLIENT_ACCESS_DENIED');
  expect(service).toHaveBeenCalledTimes(2);
});
