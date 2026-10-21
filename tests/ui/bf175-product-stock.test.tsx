import type { Session } from '@supabase/supabase-js';
import { defaultScheduler, notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { useProductStock } from '@/features/products/hooks/useProductStock';
import { selectProductStock } from '@/features/products/utils/productStock';
import { createTestQueryClient } from '@/test/createTestQueryClient';
jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn(), getLowStockProducts: jest.fn() },
}));
const service = jest.mocked(inventoryService);
const at = '2026-01-01T00:00:00Z';
function context(
  businessId = 'b',
  userId = 'u',
  membershipId = 'm',
  role: 'OWNER' | 'BARBER' = 'OWNER',
) {
  const session: Session = {
    access_token: 'test-only',
    refresh_token: 'test-only',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: at },
  };
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'authenticated', session, user: session.user, error: null });
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    error: null,
    isFetching: false,
    data: {
      membershipId,
      role,
      business: {
        id: businessId,
        name: 'Demo',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
  return session;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(
  initialIds: readonly string[] = ['p'],
  seed?: (client: ReturnType<typeof createTestQueryClient>) => void,
) {
  let ids = initialIds;
  let value!: ReturnType<typeof useProductStock>;
  const client = createTestQueryClient();
  seed?.(client);
  function Probe() {
    value = useProductStock(ids);
    return null;
  }
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const view = await render(tree());
  return {
    client,
    get hook() {
      return value;
    },
    rerender: async (next = ids) => {
      ids = next;
      await view.rerender(tree());
    },
    unmount: () => view.unmount(),
  };
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  jest.mocked(useIsFocused).mockReturnValue(true);
  service.getProductStock.mockImplementation(async (_b, ids) => ({
    data: ids.map((product_id) => ({ product_id, current_stock: '8' })),
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
test('pending -> exact positive and zero stock from one batch, missing != zero', async () => {
  const d = deferred<Awaited<ReturnType<typeof inventoryService.getProductStock>>>();
  service.getProductStock.mockReturnValueOnce(d.promise);
  const h = await mount(['positive', 'zero', 'missing']);
  expect(h.hook.status).toBe('pending');
  expect(selectProductStock(h.hook, 'zero').status).toBe('pending');
  await act(async () =>
    d.resolve({
      data: [
        { product_id: 'positive', current_stock: '9007199254740993' },
        { product_id: 'zero', current_stock: '0' },
      ],
      error: null,
    }),
  );
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(selectProductStock(h.hook, 'positive')).toEqual({
    status: 'success',
    value: '9007199254740993',
  });
  expect(selectProductStock(h.hook, 'zero')).toEqual({ status: 'success', value: '0' });
  expect(selectProductStock(h.hook, 'missing')).toEqual({ status: 'unavailable' });
  expect(service.getProductStock).toHaveBeenCalledTimes(1);
});
test('ID set normalized, empty does not query, reorder does not duplicate RPC', async () => {
  const h = await mount([]);
  expect(h.hook.status).toBe('success');
  expect(service.getProductStock).not.toHaveBeenCalled();
  await h.rerender(['p2', 'p', 'p2']);
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(service.getProductStock).toHaveBeenLastCalledWith('b', ['p', 'p2']);
  await h.rerender(['p2', 'p']);
  expect(service.getProductStock).toHaveBeenCalledTimes(1);
  expect(service.getLowStockProducts).not.toHaveBeenCalled();
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s reads authorized active/archived product IDs without alerts/settings',
  async (role) => {
    context('b', 'u', 'm', role);
    const h = await mount(['active', 'archived']);
    await waitFor(() => expect(h.hook.status).toBe('success'));
    expect(selectProductStock(h.hook, 'archived')).toEqual({ status: 'success', value: '8' });
    expect(service.getLowStockProducts).not.toHaveBeenCalled();
  },
);
test('safe error stays error without automatic retry; explicit retry restores stock', async () => {
  service.getProductStock.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'secret SQL' },
  });
  const h = await mount();
  await waitFor(() => expect(h.hook.status).toBe('error'));
  expect(h.hook.error?.message).not.toContain('secret');
  expect(service.getProductStock).toHaveBeenCalledTimes(1);
  await act(async () => h.hook.refetch());
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(service.getProductStock).toHaveBeenCalledTimes(2);
});
test('unexpected transport rejection is safe', async () => {
  service.getProductStock.mockRejectedValueOnce(new Error('secret RPC'));
  const h = await mount();
  await waitFor(() => expect(h.hook.status).toBe('error'));
  expect(h.hook.error?.code).toBe('UNKNOWN_ERROR');
  expect(h.hook.error?.message).not.toContain('secret');
});
test('invalid IDs do not reach Inventory', async () => {
  const h = await mount([' ']);
  expect(h.hook.status).toBe('error');
  expect(service.getProductStock).not.toHaveBeenCalled();
});
for (const status of ['unauthenticated', 'initializing', 'recovering'] as const)
  test(status + ' cannot read or reuse cached stock', async () => {
    const session = context();
    jest
      .mocked(useAuth)
      .mockReturnValue(
        status === 'recovering'
          ? { status, session, user: session.user, error: null }
          : { status, session: null, user: null, error: null },
      );
    const h = await mount();
    expect(h.hook.status).toBe('idle');
    expect(service.getProductStock).not.toHaveBeenCalled();
    await act(async () => h.hook.refetch());
    expect(service.getProductStock).not.toHaveBeenCalled();
  });
test('missing business and blur prevent reads', async () => {
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  const h = await mount();
  expect(h.hook.status).toBe('idle');
  context();
  jest.mocked(useIsFocused).mockReturnValue(false);
  await h.rerender();
  expect(h.hook.status).toBe('idle');
  expect(service.getProductStock).not.toHaveBeenCalled();
});
for (const change of [
  'business',
  'user',
  'membership',
  'product',
  'logout',
  'unmount',
  'blur',
] as const)
  test('late ' + change + ' response cannot publish or reuse old context', async () => {
    const d = deferred<Awaited<ReturnType<typeof inventoryService.getProductStock>>>();
    service.getProductStock.mockReturnValueOnce(d.promise);
    const h = await mount();
    const old = h.hook;
    if (change === 'business') context('other');
    if (change === 'user') context('b', 'other');
    if (change === 'membership') context('b', 'u', 'other');
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (change === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    if (change === 'unmount') await h.unmount();
    else await h.rerender(change === 'product' ? ['next'] : ['p']);
    await act(async () =>
      d.resolve({ data: [{ product_id: 'p', current_stock: '999' }], error: null }),
    );
    if (['logout', 'blur'].includes(change)) expect(h.hook.status).toBe('idle');
    else if (change !== 'unmount') {
      await waitFor(() => expect(h.hook.status).toBe('success'));
      expect(h.hook.data).not.toContainEqual({ product_id: 'p', current_stock: '999' });
    }
    const calls = service.getProductStock.mock.calls.length;
    await act(async () => old.refetch());
    expect(service.getProductStock).toHaveBeenCalledTimes(calls);
  });
test('existing business inventory invalidation refetches this operational reader', async () => {
  const h = await mount();
  await waitFor(() => expect(h.hook.status).toBe('success'));
  await act(async () =>
    h.client.invalidateQueries({ queryKey: inventoryKeys.byBusiness('other') }),
  );
  expect(service.getProductStock).toHaveBeenCalledTimes(1);
  await act(async () => h.client.invalidateQueries({ queryKey: inventoryKeys.byBusiness('b') }));
  expect(service.getProductStock).toHaveBeenCalledTimes(2);
});
