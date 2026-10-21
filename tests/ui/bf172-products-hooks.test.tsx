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
import { productsKeys } from '@/features/products/constants/productsKeys';
import { useProductList } from '@/features/products/hooks/useProductList';
import { useProductDetail } from '@/features/products/hooks/useProductDetail';
import { useCreateProduct } from '@/features/products/hooks/useCreateProduct';
import { useUpdateProduct } from '@/features/products/hooks/useUpdateProduct';
import { productsService } from '@/features/products/services/productsService';
import type {
  CreateProductInput,
  UpdateProductInput,
} from '@/features/products/schemas/product.schema';
import type {
  ProductListPage,
  ProductListInput,
  ProductResult,
} from '@/features/products/types/productHooks.types';
import type { ProductRow } from '@/features/products/types/product.types';
import { productError } from '@/features/products/utils/productErrors';
import { createTestQueryClient } from '@/test/createTestQueryClient';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: {
    listByBusiness: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
const service = jest.mocked(productsService);
const at = '2026-01-01T00:00:00Z';
const scope = { businessId: 'b', userId: 'u', membershipId: 'm' };
const payload = (): CreateProductInput => ({
  name: '  Original  ',
  category_id: 'c',
  sale_price: 10.5,
  default_purchase_cost: 6.5,
  minimum_stock: 0,
  description: null,
  sku: null,
});
const row = (id = 'e', businessId = 'b'): ProductRow => ({
  ...payload(),
  id,
  business_id: businessId,
  name: 'Original',
  category_id: 'c',
  description: null,
  sku: null,
  is_active: true,
  created_at: at,
  updated_at: at,
});
const page = (businessId = 'b'): ProductListPage => ({
  items: [row('e', businessId)],
  page: 1,
  pageSize: 25,
  hasNextPage: false,
});
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
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role,
      business: {
        id: businessId,
        name: 'Test',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount<T>(
  hook: () => T,
  seed?: (client: ReturnType<typeof createTestQueryClient>) => void,
) {
  const client = createTestQueryClient();
  seed?.(client);
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
  service.listByBusiness.mockImplementation(async (b) => ({ data: page(b), error: null }));
  service.getById.mockImplementation(async (b, id) => ({ data: row(id, b), error: null }));
  service.create.mockResolvedValue({ data: row(), error: null });
  service.update.mockResolvedValue({ data: row(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
});

test('list pending -> success preserves normalized params, empty metadata and explicit refetch', async () => {
  const d = deferred<ProductResult<ProductListPage>>();
  service.listByBusiness.mockReturnValueOnce(d.promise);
  const params: ProductListInput = {
    page: 2,
    pageSize: 10,
    status: 'all',
    categoryId: ' old ',
  };
  const h = await mount(() => useProductList(params));
  expect(h.hook.status).toBe('pending');
  expect(service.listByBusiness).toHaveBeenCalledWith('b', params);
  expect(service.listByBusiness).toHaveBeenCalledTimes(1);
  await act(async () =>
    d.resolve({ data: { items: [], page: 2, pageSize: 10, hasNextPage: false }, error: null }),
  );
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(h.hook.data?.items).toEqual([]);
  await act(async () => h.hook.refetch());
  expect(service.listByBusiness).toHaveBeenCalledTimes(2);
  expect(service.getById).not.toHaveBeenCalled();
});
test('list default params and every filter change produce isolated data requests', async () => {
  let params: ProductListInput | undefined;
  const h = await mount(() => useProductList(params));
  await waitFor(() => expect(h.hook.status).toBe('success'));
  expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  params = {
    page: 3,
    pageSize: 7,
    status: 'inactive',
    categoryId: 'c',
  };
  await h.rerender();
  await waitFor(() => expect(service.listByBusiness).toHaveBeenCalledWith('b', params));
});
test('query error hides previous data and no automatic retry despite global retry defaults', async () => {
  const h = await mount(
    () => useProductList(),
    (c) => c.setDefaultOptions({ queries: { retry: 2, retryDelay: 0, gcTime: Infinity } }),
  );
  await waitFor(() => expect(h.hook.status).toBe('success'));
  const error = productError('NETWORK_ERROR');
  service.listByBusiness.mockResolvedValue({ data: null, error });
  await act(async () => h.hook.refetch());
  await waitFor(() => expect(h.hook.status).toBe('error'));
  expect(h.hook.data).toBeNull();
  expect(h.hook.error).toEqual(error);
  expect(service.listByBusiness).toHaveBeenCalledTimes(2);
});
for (const invalid of [{ page: 0 }, { pageSize: 101 }, { status: 'bad' as const }])
  test(`invalid params ${JSON.stringify(invalid)} disable requests and refetch`, async () => {
    const h = await mount(() => useProductList(invalid as ProductListInput));
    expect(h.hook.error?.code).toBe('INVALID_INPUT');
    await act(async () => h.hook.refetch());
    expect(service.listByBusiness).not.toHaveBeenCalled();
  });
for (const unavailable of [
  'logout',
  'recovery',
  'business-pending',
  'blank-business',
  'blank-user',
  'blank-member',
  'blur',
])
  test(`scope gate ${unavailable}: queries/mutations do not send`, async () => {
    if (unavailable === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (unavailable === 'recovery') {
      const a = jest.mocked(useAuth)();
      if (a.status === 'authenticated')
        jest.mocked(useAuth).mockReturnValue({ ...a, status: 'recovering' });
    }
    if (unavailable === 'business-pending')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
    if (unavailable === 'barber') context('b', 'u', 'm', 'BARBER');
    if (unavailable === 'blank-business') context(' ');
    if (unavailable === 'blank-user') context('b', ' ');
    if (unavailable === 'blank-member') context('b', 'u', ' ');
    if (unavailable === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    const list = await mount(() => useProductList());
    const detail = await mount(() => useProductDetail('e'));
    const create = await mount(() => useCreateProduct());
    expect(list.hook.status).toBe('idle');
    expect(detail.hook.status).toBe('idle');
    await act(async () => {
      await list.hook.refetch();
      await detail.hook.refetch();
      await expect(create.hook.mutateAsync(payload())).rejects.toMatchObject({
        code: 'PRODUCT_ACCESS_DENIED',
      });
    });
    expect(service.listByBusiness).not.toHaveBeenCalled();
    expect(service.getById).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });
test('business switch late list response cannot publish or populate new tenant; old refetch inert', async () => {
  const d = deferred<ProductResult<ProductListPage>>();
  service.listByBusiness.mockReturnValueOnce(d.promise);
  const h = await mount(() => useProductList());
  const old = h.hook;
  context('other');
  await h.rerender();
  await waitFor(() => expect(h.hook.data?.items[0]?.business_id).toBe('other'));
  await act(async () => {
    d.resolve({ data: page('b'), error: null });
    await old.refetch();
  });
  expect(h.hook.data?.items[0]?.business_id).toBe('other');
  expect(service.listByBusiness).toHaveBeenCalledTimes(2);
  expect(
    h.client.getQueryData(productsKeys.list(scope, { page: 1, pageSize: 25, status: 'active' })),
  ).toBeUndefined();
});
test('detail IDs gate, pending -> success, source linkage/error/refetch preserved', async () => {
  let id: string | null = null;
  const h = await mount(() => useProductDetail(id));
  expect(h.hook.error?.code).toBe('INVALID_INPUT');
  await act(async () => h.hook.refetch());
  expect(service.getById).not.toHaveBeenCalled();
  const d = deferred<ProductResult>();
  service.getById.mockReturnValueOnce(d.promise);
  id = 'e';
  await h.rerender();
  expect(h.hook.status).toBe('pending');
  const purchase = { ...row(), source_type: 'PURCHASE' as const, purchase_id: 'p' };
  await act(async () => d.resolve({ data: purchase, error: null }));
  await waitFor(() => expect(h.hook.data).toEqual(purchase));
  service.getById.mockResolvedValue({ data: null, error: productError('PRODUCT_NOT_FOUND') });
  await act(async () => h.hook.refetch());
  expect(h.hook.data).toBeNull();
  expect(h.hook.error?.code).toBe('PRODUCT_NOT_FOUND');
});
test('detail product switch late A cannot overwrite B, old refetch cannot reload A', async () => {
  const d = deferred<ProductResult>();
  service.getById.mockReturnValueOnce(d.promise);
  let id = 'a';
  const h = await mount(() => useProductDetail(id));
  const old = h.hook;
  id = 'b-product';
  await h.rerender();
  await waitFor(() => expect(h.hook.data?.id).toBe(id));
  await act(async () => {
    d.resolve({ data: row('a'), error: null });
    await old.refetch();
  });
  expect(h.hook.data?.id).toBe(id);
  expect(service.getById).toHaveBeenCalledTimes(2);
});
test('unexpected read rejection becomes safe UNKNOWN_ERROR', async () => {
  service.getById.mockRejectedValue(new Error('private SQL payload'));
  const h = await mount(() => useProductDetail('e'));
  await waitFor(() => expect(h.hook.status).toBe('error'));
  expect(h.hook.error).toEqual(productError('UNKNOWN_ERROR'));
});
test('create pending/success, coalesces rapid submit, freezes input and invalidates only actual product prefix', async () => {
  const d = deferred<ProductResult>();
  service.create.mockReturnValueOnce(d.promise);
  const h = await mount(() => useCreateProduct());
  const invalidation = jest.spyOn(h.client, 'invalidateQueries');
  const input = payload();
  let first!: Promise<ProductRow>;
  let second!: Promise<ProductRow>;
  await act(async () => {
    first = h.hook.mutateAsync(input);
    second = h.hook.mutateAsync({ ...input, sale_price: 99.0 });
  });
  expect(first).toBe(second);
  expect(h.hook.status).toBe('pending');
  expect(service.create).toHaveBeenCalledTimes(1);
  input.sale_price = 999;
  input.description = 'changed';
  expect(service.create.mock.calls[0]?.[1]).toEqual(payload());
  await act(async () => {
    d.resolve({ data: row(), error: null });
    await first;
  });
  expect(h.hook.status).toBe('success');
  expect(invalidation.mock.calls).toEqual([
    [{ queryKey: ['products', 'b'] }, { throwOnError: true }],
  ]);
  await act(async () => h.hook.retry());
  expect(service.create).toHaveBeenCalledTimes(1);
});
test('confirmed create remains SUCCESS when read invalidation rejects; retryReads never resends', async () => {
  const h = await mount(() => useCreateProduct());
  const invalidate = jest
    .spyOn(h.client, 'invalidateQueries')
    .mockRejectedValueOnce(new Error('read refresh failed'));
  await act(async () => {
    await expect(h.hook.mutateAsync(payload())).resolves.toEqual(row());
  });
  expect(h.hook.status).toBe('success');
  expect(h.hook.refreshError).toBe(true);
  invalidate.mockResolvedValueOnce();
  await act(async () => h.hook.retryReads());
  expect(h.hook.refreshError).toBe(false);
  expect(service.create).toHaveBeenCalledTimes(1);
});
test('success visible before awaited refresh, reset pending cannot permit a second write', async () => {
  const h = await mount(() => useCreateProduct());
  const maintenance = deferred<void>();
  jest.spyOn(h.client, 'invalidateQueries').mockReturnValueOnce(maintenance.promise);
  let result!: Promise<ProductRow>;
  await act(async () => {
    result = h.hook.mutateAsync(payload());
  });
  await waitFor(() => expect(h.hook.status).toBe('success'));
  let duplicate!: Promise<ProductRow>;
  await act(async () => {
    h.hook.reset();
    duplicate = h.hook.mutateAsync(payload());
  });
  expect(duplicate).toBe(result);
  expect(service.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    maintenance.resolve();
    await result;
  });
  await act(async () => h.hook.reset());
  expect(h.hook.status).toBe('idle');
  expect(h.client.getQueryCache().getAll()).toEqual([]);
});
test('NETWORK_ERROR preserved, no retry on reconnect; explicit retry uses original snapshot', async () => {
  const safe = productError('NETWORK_ERROR');
  service.create.mockResolvedValueOnce({ data: null, error: safe });
  const h = await mount(() => useCreateProduct());
  const input = payload();
  await act(async () => {
    await expect(h.hook.mutateAsync(input)).rejects.toEqual(safe);
  });
  expect(h.hook.error).toEqual(safe);
  input.sale_price = 999.99;
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  expect(service.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    await expect(h.hook.retry()).resolves.toEqual(row());
  });
  expect(service.create.mock.calls[1]?.[1]).toEqual(payload());
});
test('offline mutation is not parked for automatic future write', async () => {
  onlineManager.setOnline(false);
  service.create.mockResolvedValue({ data: null, error: productError('NETWORK_ERROR') });
  const h = await mount(() => useCreateProduct());
  await act(async () => {
    await expect(h.hook.mutateAsync(payload())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  onlineManager.setOnline(true);
  expect(service.create).toHaveBeenCalledTimes(1);
});
test('reset clears feedback without clearing queries; next explicit intent allowed', async () => {
  const h = await mount(() => useCreateProduct());
  await act(async () => h.hook.mutateAsync(payload()));
  const key = ['products', 'b', 'unrelated'];
  h.client.setQueryData(key, 'retained');
  await act(async () => h.hook.reset());
  expect(h.hook.status).toBe('idle');
  expect(h.client.getQueryData(key)).toBe('retained');
  await act(async () => h.hook.mutateAsync({ ...payload(), description: 'second intent' }));
  expect(service.create).toHaveBeenCalledTimes(2);
});
for (const transition of [
  'business',
  'user',
  'member',
  'logout',
  'recovery',
  'blur',
  'unmount',
  'a-b-a',
])
  test(`late create after ${transition} cannot publish or invalidate new context; old closures rejected`, async () => {
    const d = deferred<ProductResult>();
    service.create.mockReturnValueOnce(d.promise);
    const h = await mount(() => useCreateProduct());
    const old = h.hook;
    const invalidate = jest.spyOn(h.client, 'invalidateQueries');
    let pending!: Promise<ProductRow>;
    await act(async () => {
      pending = old.mutateAsync(payload());
      pending.catch(() => undefined);
    });
    if (transition === 'business' || transition === 'a-b-a') context('other');
    if (transition === 'user') context('b', 'other');
    if (transition === 'member') context('b', 'u', 'other');
    if (transition === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (transition === 'recovery') {
      const a = jest.mocked(useAuth)();
      if (a.status === 'authenticated')
        jest.mocked(useAuth).mockReturnValue({ ...a, status: 'recovering' });
    }
    if (transition === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    if (transition === 'unmount') await h.unmount();
    else await h.rerender();
    if (transition === 'a-b-a') {
      context();
      await h.rerender();
    }
    await act(async () => {
      d.resolve({ data: row(), error: null });
      await expect(pending).rejects.toMatchObject({ code: 'PRODUCT_ACCESS_DENIED' });
      await expect(old.mutateAsync(payload())).rejects.toMatchObject({
        code: 'PRODUCT_ACCESS_DENIED',
      });
      await expect(old.retry()).rejects.toMatchObject({ code: 'PRODUCT_ACCESS_DENIED' });
      old.reset();
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledTimes(1);
    if (transition !== 'unmount') expect(h.hook.status).toBe('idle');
  });
test('manual update captures id/tenant/partial snapshot; prefix invalidates lists AND detail but not categories/analytics', async () => {
  const d = deferred<ProductResult>();
  service.update.mockReturnValueOnce(d.promise);
  const h = await mount(() => useUpdateProduct('e'));
  const listKey = productsKeys.list(scope, { page: 1, pageSize: 25, status: 'active' });
  const detailKey = productsKeys.detail(scope, 'e');
  h.client.setQueryData(listKey, page());
  h.client.setQueryData(detailKey, row());
  h.client.setQueryData(['productCategories', 'b'], 'categories');
  h.client.setQueryData(['home', 'b'], 'home');
  const input: UpdateProductInput = { description: '', sku: null };
  let pending!: Promise<ProductRow>;
  await act(async () => {
    pending = h.hook.mutateAsync(input);
  });
  input.description = 'changed';
  expect(service.update).toHaveBeenCalledWith('b', 'e', { description: '', sku: null });
  await act(async () => {
    d.resolve({ data: row(), error: null });
    await pending;
  });
  expect(h.client.getQueryState(listKey)?.isInvalidated).toBe(true);
  expect(h.client.getQueryState(detailKey)?.isInvalidated).toBe(true);
  expect(h.client.getQueryState(['productCategories', 'b'])?.isInvalidated).toBe(false);
  expect(h.client.getQueryState(['home', 'b'])?.isInvalidated).toBe(false);
});
test('late update A cannot overwrite B and does not invalidate after changing product', async () => {
  const d = deferred<ProductResult>();
  service.update.mockReturnValueOnce(d.promise);
  let id = 'e';
  const h = await mount(() => useUpdateProduct(id));
  const invalidate = jest.spyOn(h.client, 'invalidateQueries');
  let pending!: Promise<ProductRow>;
  await act(async () => {
    pending = h.hook.mutateAsync({ description: 'A' });
    pending.catch(() => undefined);
  });
  id = 'other-product';
  await h.rerender();
  await act(async () => {
    d.resolve({ data: row(), error: null });
    await expect(pending).rejects.toMatchObject({ code: 'PRODUCT_ACCESS_DENIED' });
  });
  expect(h.hook.status).toBe('idle');
  expect(invalidate).not.toHaveBeenCalled();
});
test('invalid update id/input and retry without intent cannot send', async () => {
  const h = await mount(() => useUpdateProduct(null));
  await act(async () => {
    await expect(h.hook.mutateAsync({ description: 'x' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(h.hook.retry()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  expect(service.update).not.toHaveBeenCalled();
  const create = await mount(() => useCreateProduct());
  await act(async () => {
    await expect(create.hook.mutateAsync({ ...payload(), sale_price: -1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
  expect(service.create).not.toHaveBeenCalled();
});
test('unexpected service rejection cannot leak raw SDK/SQL data', async () => {
  service.create.mockRejectedValue(new Error('secret token SQL'));
  const h = await mount(() => useCreateProduct());
  await act(async () => {
    await expect(h.hook.mutateAsync(payload())).rejects.toEqual(productError('UNKNOWN_ERROR'));
  });
  expect(h.hook.error).toEqual(productError('UNKNOWN_ERROR'));
  expect(JSON.stringify(h.hook.error)).not.toContain('secret');
});

test('BARBER can read both resources but cannot start catalog writes', async () => {
  context('b', 'u', 'm', 'BARBER');
  const list = await mount(() => useProductList());
  const detail = await mount(() => useProductDetail('e'));
  await waitFor(() => expect(detail.hook.status).toBe('success'));
  expect(list.hook.status).toBe('success');
  const write = await mount(() => useCreateProduct());
  await act(async () => {
    await expect(write.hook.mutateAsync(payload())).rejects.toMatchObject({
      code: 'PRODUCT_ACCESS_DENIED',
    });
  });
  expect(service.create).not.toHaveBeenCalled();
});
