import type { Session } from '@supabase/supabase-js';
import {
  defaultScheduler,
  notifyManager,
  onlineManager,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useCompletePurchase } from '@/features/purchases/hooks/useCompletePurchase';
import type { CompletePurchaseInput } from '@/features/purchases/schemas/purchase.schema';
import { purchasesService } from '@/features/purchases/services/purchasesService';
import { purchaseDraftStore } from '@/features/purchases/store/purchaseDraftStore';
import type {
  CompletePurchaseData,
  CompletePurchaseErrorCode,
  CompletePurchaseResult,
  UseCompletePurchaseResult,
} from '@/features/purchases/types/completePurchase.types';
import { createTestQueryClient } from '@/test/createTestQueryClient';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/purchases/services/purchasesService', () => ({
  purchasesService: { completePurchase: jest.fn() },
}));
const service = jest.mocked(purchasesService.completePurchase);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const businessId = id(216);
const payload = (): CompletePurchaseInput => ({
  operationId: id(1),
  supplierName: 'Supplier',
  expenseCategoryId: id(2),
  paymentMethod: 'CASH',
  purchasedAt: '2026-01-01T00:00:00Z',
  items: [{ productId: id(3), quantity: 1, unitCost: '1.00' }],
});
const at = '2026-01-01T00:00:00Z';
const saved = (): CompletePurchaseData => ({
  purchase: {
    id: id(4),
    business_id: businessId,
    operation_id: id(1),
    supplier: 'Original',
    status: 'COMPLETED',
    total: 1,
    purchased_at: at,
    notes: null,
    created_by: id(5),
    created_at: at,
    updated_at: at,
  },
  items: [
    {
      id: id(6),
      purchase_id: id(4),
      product_id: id(3),
      product_name_snapshot: 'Original',
      quantity: 1,
      unit_cost_snapshot: 1,
      line_total: 1,
      created_at: at,
    },
  ],
  expense: {
    id: id(7),
    business_id: businessId,
    category_id: id(2),
    source_type: 'PURCHASE',
    purchase_id: id(4),
    description: 'Compra de productos',
    amount: 1,
    payment_method: 'CASH',
    expense_date: '2026-01-01',
    notes: null,
    receipt_path: null,
    created_by: id(5),
    created_at: at,
    updated_at: at,
  },
});
function auth(userId = id(5)) {
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
}
function business(b = businessId, member = id(8), role: 'OWNER' | 'BARBER' = 'OWNER') {
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId: member,
      role,
      business: { id: b, name: 'Test', timezone: 'UTC', currency_code: 'ARS', is_active: true },
    },
  });
}
const draft = () => purchaseDraftStore.getState();
function deferred() {
  let resolve!: (value: CompletePurchaseResult) => void;
  const promise = new Promise<CompletePurchaseResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup() {
  const client = createTestQueryClient();
  let hook!: UseCompletePurchaseResult;
  function Probe() {
    hook = useCompletePurchase();
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
      return hook;
    },
    rerender: () => view.rerender(element()),
    unmount: () => view.unmount(),
  };
}
beforeEach(() => {
  // Keep this suite's mutation notifications in the awaited act microtasks.
  notifyManager.setScheduler(queueMicrotask);
  auth();
  business();
  onlineManager.setOnline(true);
  draft().setBusiness(null);
  draft().setBusiness(businessId);
  draft().startDraft(businessId, id(1));
  service.mockResolvedValue({ data: saved(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
  draft().setBusiness(null);
});

test('BF216 initial idle, invalid input and retry without attempt never send', async () => {
  const view = await setup();
  expect(view.hook.status).toBe('idle');
  await act(async () => {
    await expect(view.hook.retry()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  await act(async () => {
    await expect(view.hook.mutateAsync({ ...payload(), items: [] })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
  expect(service).not.toHaveBeenCalled();
  expect(draft().draft).not.toBeNull();
});
test('BF216 pending double submit shares one promise; success clears matching draft and only inventory cache', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  const view = await setup();
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  let first!: Promise<CompletePurchaseData>;
  let second!: Promise<CompletePurchaseData>;
  await act(() => {
    first = view.hook.mutateAsync(payload());
    second = view.hook.mutateAsync(payload());
    view.hook.reset();
  });
  expect(first).toBe(second);
  expect(view.hook.status).toBe('pending');
  await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
    await first;
  });
  expect(view.hook.status).toBe('success');
  expect(draft().draft).toBeNull();
  expect(invalidation).toHaveBeenCalledTimes(1);
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ['inventory', businessId] });
});
test('BF216 network uncertainty and reset retain original frozen payload/operation for explicit retry', async () => {
  service.mockResolvedValueOnce({ data: null, error: { code: 'NETWORK_ERROR', message: 'safe' } });
  const view = await setup();
  const original = payload();
  await act(async () => {
    await expect(view.hook.mutateAsync(original)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  expect(draft().draft?.operationId).toBe(original.operationId);
  original.items[0].unitCost = '8.00';
  original.supplierName = 'Changed';
  await act(() => view.hook.reset());
  expect(view.hook.status).toBe('idle');
  await act(async () => {
    await view.hook.retry();
  });
  expect(service).toHaveBeenCalledTimes(2);
  expect(service.mock.calls[1]).toEqual(service.mock.calls[0]);
  expect(service.mock.calls[1][1].supplierName).toBe('Supplier');
  expect(service.mock.calls[1][1].items[0].unitCost).toBe('1.00');
  expect(view.hook.status).toBe('success');
  expect(draft().draft).toBeNull();
});
test.each<CompletePurchaseErrorCode>([
  'INVALID_INPUT',
  'ACCESS_DENIED',
  'INVALID_STATUS',
  'CONFLICT',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
])('BF216 %s never clears draft or invalidates', async (code) => {
  service.mockResolvedValue({ data: null, error: { code, message: 'safe' } });
  const view = await setup();
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  await act(async () => {
    await expect(view.hook.mutateAsync(payload())).rejects.toMatchObject({ code });
  });
  expect(view.hook.status).toBe('error');
  expect(draft().draft?.operationId).toBe(id(1));
  expect(invalidation).not.toHaveBeenCalled();
});
test.each(['logout', 'recovery', 'user', 'business', 'membership', 'barber', 'unmount'])(
  'BF216 stale %s suppresses state, cleanup and cache without pretending server cancellation',
  async (change) => {
    const pending = deferred();
    service.mockReturnValue(pending.promise);
    const view = await setup();
    const invalidation = jest.spyOn(view.client, 'invalidateQueries');
    let request!: Promise<CompletePurchaseData>;
    await act(() => {
      request = view.hook.mutateAsync(payload());
    });
    await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (change === 'recovery') {
      const authenticated = useAuth();
      if (authenticated.status !== 'authenticated') throw new Error('Invalid auth fixture');
      jest.mocked(useAuth).mockReturnValue({ ...authenticated, status: 'recovering' });
    }
    if (change === 'user') auth(id(99));
    if (change === 'business') business(id(99));
    if (change === 'membership') business(businessId, id(99));
    if (change === 'barber') business(businessId, id(8), 'BARBER');
    if (change === 'unmount') await view.unmount();
    else await view.rerender();
    const rejection = expect(request).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await act(async () => {
      pending.resolve({ data: saved(), error: null });
      await rejection;
    });
    if (change !== 'unmount') expect(view.hook.status).toBe('idle');
    expect(draft().draft?.operationId).toBe(id(1));
    expect(invalidation).not.toHaveBeenCalled();
  },
);
test('BF216 returning to same IDs does not revive an old request epoch', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  const view = await setup();
  let request!: Promise<CompletePurchaseData>;
  await act(() => {
    request = view.hook.mutateAsync(payload());
  });
  await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  business(id(99));
  await view.rerender();
  business();
  await view.rerender();
  const rejection = expect(request).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
    await rejection;
  });
  expect(view.hook.status).toBe('idle');
  expect(draft().draft).not.toBeNull();
});
test('BF216 callbacks from an earlier scope cannot submit, reset or expose error in the new scope', async () => {
  const view = await setup();
  const old = view.hook;
  business(id(99));
  await view.rerender();
  await act(async () => {
    await expect(old.mutateAsync(payload())).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(old.retry()).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    old.reset();
  });
  expect(view.hook.status).toBe('idle');
  expect(service).not.toHaveBeenCalled();
  business();
  await view.rerender();
  await act(async () => {
    await expect(old.mutateAsync(payload())).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  expect(view.hook.status).toBe('idle');
  expect(service).not.toHaveBeenCalled();
});
test('BF216 late success never clears a newer draft and cache failure preserves success', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  const view = await setup();
  jest.spyOn(view.client, 'invalidateQueries').mockRejectedValue(new Error('refresh fixture'));
  let request!: Promise<CompletePurchaseData>;
  await act(() => {
    request = view.hook.mutateAsync(payload());
  });
  await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  draft().clearDraft(businessId, id(1));
  draft().startDraft(businessId, id(90));
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
    await request;
  });
  expect(view.hook.status).toBe('success');
  expect(draft().draft?.operationId).toBe(id(90));
});
test('BF216 offline failure does not auto-send on reconnect; explicit retry succeeds', async () => {
  onlineManager.setOnline(false);
  service.mockResolvedValueOnce({ data: null, error: { code: 'NETWORK_ERROR', message: 'safe' } });
  const view = await setup();
  await act(async () => {
    await expect(view.hook.mutateAsync(payload())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  await act(() => onlineManager.setOnline(true));
  expect(service).toHaveBeenCalledTimes(1);
  await act(async () => {
    await view.hook.retry();
  });
  expect(service).toHaveBeenCalledTimes(2);
  expect(view.hook.status).toBe('success');
});
test('BF216 confirmed replay success clears draft; new intention requires explicit new draft', async () => {
  const history = saved();
  history.purchase.status = 'VOIDED';
  service.mockResolvedValue({ data: history, error: null });
  const view = await setup();
  await act(async () => {
    await view.hook.mutateAsync(payload());
    await view.hook.mutateAsync(payload());
  });
  expect(service).toHaveBeenCalledTimes(1);
  expect(draft().draft).toBeNull();
  await act(async () => {
    await expect(
      view.hook.mutateAsync({ ...payload(), operationId: id(90) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  draft().startDraft(businessId, id(90));
  await act(async () => {
    await view.hook.mutateAsync({ ...payload(), operationId: id(90) });
  });
  expect(service).toHaveBeenCalledTimes(2);
});
