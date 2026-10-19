import { usePurchaseDetail } from '@/features/purchases/hooks/usePurchaseDetail';
import type { Session } from '@supabase/supabase-js';
import { defaultScheduler, notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { purchasesKeys } from '@/features/purchases/constants/purchasesKeys';
import {
  useVoidPurchase,
  type UseVoidPurchaseResult,
} from '@/features/purchases/hooks/useVoidPurchase';
import { PurchaseHistoryScreen } from '@/features/purchases/screens/PurchaseHistoryScreen';
import { PurchaseDetailScreen } from '@/features/purchases/screens/PurchaseDetailScreen';
import { purchaseDetailFromVoid } from '@/features/purchases/services/purchaseDetailFromVoid';
import { purchasesService } from '@/features/purchases/services/purchasesService';
import { voidPurchaseError } from '@/features/purchases/services/voidPurchaseErrors';
import type {
  VoidPurchaseData,
  VoidPurchaseErrorCode,
  VoidPurchaseResult,
} from '@/features/purchases/types/voidPurchase.types';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { routerMock } from '@/test/routerTestUtils';

import { id, at, businessId, detail, voidSaved } from './helpers/purchaseFixtures';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/purchases/services/purchasesService', () => ({
  purchasesService: { listByBusiness: jest.fn(), getById: jest.fn(), voidPurchase: jest.fn() },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core'),
  uuid: { v4: () => '00000000-0000-4000-8000-000000000099' },
}));
let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  router: {
    ...jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
    canGoBack: () => false,
  },
}));
const service = jest.mocked(purchasesService);
function scope(b = businessId, member = id(8), role: 'OWNER' | 'BARBER' = 'OWNER', user = id(5)) {
  const session: Session = {
    access_token: 'test-only',
    refresh_token: 'test-only',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: user, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: at },
  };
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'authenticated', session, user: session.user, error: null });
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
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));
async function mount(element: React.ReactNode) {
  const client = createTestQueryClient();
  const tree = (node: React.ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const view = await render(tree(element));
  return {
    client,
    unmount: () => view.unmount(),
    rerender: (node: React.ReactNode) => view.rerender(tree(node)),
  };
}
async function probe() {
  let hook!: UseVoidPurchaseResult;
  let purchaseId = id(4);
  function Probe() {
    hook = useVoidPurchase(purchaseId);
    return null;
  }
  const view = await mount(<Probe />);
  return {
    client: view.client,
    unmount: view.unmount,
    get hook() {
      return hook;
    },
    update: async (pid = purchaseId) => {
      purchaseId = pid;
      await view.rerender(<Probe />);
    },
  };
}
const input = () => ({ operationId: id(99), purchaseId: id(4), reason: '  Exact reason  ' });
beforeEach(() => {
  mockFocused = true;
  notifyManager.setScheduler(queueMicrotask);
  scope();
  service.getById.mockResolvedValue({ data: detail(), error: null });
  service.listByBusiness.mockResolvedValue({
    data: {
      items: [detail().purchase, { ...detail().purchase, id: id(10), status: 'VOIDED' }],
      page: 1,
      pageSize: 25,
      hasNextPage: false,
    },
    error: null,
  });
  service.voidPurchase.mockResolvedValue({ data: voidSaved(), error: null });
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
});

test('detail cached COMPLETED cannot overwrite confirmed VOIDED on a stale refetch', async () => {
  let read!: ReturnType<typeof usePurchaseDetail>;
  let mutate!: UseVoidPurchaseResult;
  function Probe() {
    read = usePurchaseDetail(id(4));
    mutate = useVoidPurchase(id(4));
    return null;
  }
  await mount(<Probe />);
  await waitFor(() => expect(read.status).toBe('success'));
  await act(async () => {
    await mutate.mutateAsync(input());
  });
  await waitFor(() => expect(service.getById).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(read.data?.purchase.status).toBe('VOIDED'));
  expect(mutate.status).toBe('success');
});

test('navigation blur detaches a kept-alive detail and blocks its late result and invalidations', async () => {
  const pending = deferred<VoidPurchaseResult>();
  service.voidPurchase.mockReturnValue(pending.promise);
  const view = await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Anular compra' })).toBeTruthy());
  await press('Anular compra');
  await fireEvent.changeText(screen.getByLabelText('Motivo de la anulación'), '  Exact reason  ');
  await press('Confirmar anulación');
  await waitFor(() => expect(service.voidPurchase).toHaveBeenCalledTimes(1));
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  mockFocused = false;
  await view.rerender(<PurchaseDetailScreen purchaseId={id(4)} />);
  await act(() => pending.resolve({ data: voidSaved(), error: null }));
  expect(screen.queryByText('Compra anulada en BarberFlow')).toBeNull();
  expect(invalidation).not.toHaveBeenCalled();
  mockFocused = true;
  service.getById.mockResolvedValue({
    data: purchaseDetailFromVoid(voidSaved(), detail()),
    error: null,
  });
  await view.rerender(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Anulada')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Anular compra' })).toBeNull();
});

test('detail read switching business never displays a deferred response for the old business', async () => {
  const pending = deferred<Awaited<ReturnType<typeof purchasesService.getById>>>();
  service.getById.mockReturnValueOnce(pending.promise);
  const view = await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(service.getById).toHaveBeenCalledTimes(1));
  scope(id(77));
  service.getById.mockResolvedValue({
    data: null,
    error: { code: 'NOT_FOUND', message: 'Compra no disponible.' },
  });
  await view.rerender(<PurchaseDetailScreen purchaseId={id(4)} />);
  await act(() => pending.resolve({ data: detail(), error: null }));
  await waitFor(() => expect(screen.getByText('Compra no disponible.')).toBeTruthy());
  expect(screen.queryByText('Historical product')).toBeNull();
});

test('detail background permission denial hides cached data and destructive action', async () => {
  const view = await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Historical product')).toBeTruthy());
  service.getById.mockResolvedValue({
    data: null,
    error: { code: 'ACCESS_DENIED', message: 'Acceso restringido' },
  });
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: purchasesKeys.byBusiness(businessId) });
  });
  await waitFor(() => expect(screen.getByText('Acceso restringido')).toBeTruthy());
  expect(screen.queryByText('Historical product')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Anular compra' })).toBeNull();
});

test('detail refresh failure after confirmed void keeps success and only retries reads', async () => {
  const view = await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Completada')).toBeTruthy());
  service.getById.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Read unavailable' },
  });
  await press('Anular compra');
  await fireEvent.changeText(screen.getByLabelText('Motivo de la anulación'), '  Exact reason  ');
  await press('Confirmar anulación');
  await waitFor(() => expect(screen.getByText('No se pudo actualizar la lectura')).toBeTruthy());
  expect(screen.getByText('Anulada')).toBeTruthy();
  expect(screen.getByText('Compra anulada en BarberFlow')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Anular compra' })).toBeNull();
  service.getById.mockResolvedValue({
    data: purchaseDetailFromVoid(voidSaved(), detail()),
    error: null,
  });
  await press('Reintentar');
  await waitFor(() => expect(screen.queryByText('No se pudo actualizar la lectura')).toBeNull());
  expect(service.voidPurchase).toHaveBeenCalledTimes(1);
});

test('history shows all statuses and rows navigate only, never destructive actions', async () => {
  await mount(<PurchaseHistoryScreen />);
  await waitFor(() => expect(screen.getByText('Completada')).toBeTruthy());
  expect(screen.getByText('Anulada')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Anular compra' })).toBeNull();
  const rows = screen.getAllByRole('button', { name: /Ver compra:/ });
  await userEvent.press(rows[0]);
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/purchases/[id]',
    params: { id: id(4) },
  });
  expect(service.voidPurchase).not.toHaveBeenCalled();
});
test('history loading/empty/error/read retry and pagination use read service only', async () => {
  const pending = deferred<Awaited<ReturnType<typeof purchasesService.listByBusiness>>>();
  service.listByBusiness.mockReturnValueOnce(pending.promise);
  await mount(<PurchaseHistoryScreen />);
  expect(screen.getByText('Cargando compras…')).toBeTruthy();
  await act(() =>
    pending.resolve({ data: null, error: { code: 'NETWORK_ERROR', message: 'Safe read error' } }),
  );
  await waitFor(() => expect(screen.getByText('Safe read error')).toBeTruthy());
  service.listByBusiness.mockResolvedValueOnce({
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  await press('Reintentar');
  await waitFor(() => expect(screen.getByText('No hay compras registradas')).toBeTruthy());
  expect(service.voidPurchase).not.toHaveBeenCalled();
});
test('history next/previous page uses sentinel result and defaults', async () => {
  service.listByBusiness.mockResolvedValue({
    data: { items: [detail().purchase], page: 1, pageSize: 25, hasNextPage: true },
    error: null,
  });
  await mount(<PurchaseHistoryScreen />);
  await waitFor(() => expect(screen.getByText('Completada')).toBeTruthy());
  await press('Siguiente');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith(businessId, { page: 2, pageSize: 25 }),
  );
  await press('Anterior');
  await waitFor(() => expect(screen.getByText('Página 1')).toBeTruthy());
});
test.each(['BARBER', 'logout', 'inactive'] as const)(
  'history/detail block %s without reads or cached exposure',
  async (mode) => {
    if (mode === 'BARBER') scope(businessId, id(8), 'BARBER');
    else if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    else
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
    await mount(
      <>
        <PurchaseHistoryScreen />
        <PurchaseDetailScreen purchaseId={id(4)} />
      </>,
    );
    expect(screen.queryByText('Original')).toBeNull();
    expect(service.listByBusiness).not.toHaveBeenCalled();
    expect(service.getById).not.toHaveBeenCalled();
  },
);
test('detail loading, original sections, cancel, validation, pending, confirmed success and accessible announcement', async () => {
  const pending = deferred<VoidPurchaseResult>();
  service.voidPurchase.mockReturnValue(pending.promise);
  await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Historical product')).toBeTruthy());
  expect(screen.getByText('Categoría: Archived category')).toBeTruthy();
  expect(screen.getByText('Notas: Original notes')).toBeTruthy();
  await press('Anular compra');
  await press('Cancelar');
  expect(service.voidPurchase).not.toHaveBeenCalled();
  await press('Anular compra');
  await press('Confirmar anulación');
  expect(screen.getByText('Error: Escribe el motivo de la anulación.')).toBeTruthy();
  expect(service.voidPurchase).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Motivo de la anulación'), '  Exact reason  ');
  await press('Confirmar anulación');
  await waitFor(() => expect(service.voidPurchase).toHaveBeenCalledWith(businessId, input()));
  expect(screen.getByRole('button', { name: 'Confirmar anulación' })).toBeDisabled();
  await act(() => pending.resolve({ data: voidSaved(), error: null }));
  await waitFor(() => expect(screen.getByText('Compra anulada en BarberFlow')).toBeTruthy());
  expect(screen.getByText('Anulada')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Anular compra' })).toBeNull();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
    'Compra anulada en BarberFlow',
  );
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test.each(['DRAFT', 'VOIDED'] as const)(
  '%s detail has no new destructive entry',
  async (status) => {
    const d = detail();
    d.purchase.status = status;
    d.voidInfo = status === 'VOIDED' ? { status: 'unavailable' } : { status: 'not_applicable' };
    service.getById.mockResolvedValue({ data: d, error: null });
    await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
    await waitFor(() => expect(screen.getByText('Historical product')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Anular compra' })).toBeNull();
    if (status === 'VOIDED')
      expect(screen.getByText('Información de anulación no disponible')).toBeTruthy();
  },
);
test('VOIDED audit retains duplicate historical lines, exact reason, date, neutral actor and original expense, no technical IDs', async () => {
  const d = purchaseDetailFromVoid(voidSaved(), detail());
  d.items.push({ ...d.items[0], id: id(7), quantity: 3 });
  if (d.voidInfo.status === 'available')
    d.voidInfo.stockCompensation.push({ purchase_item_id: id(7), quantity_delta: -3 });
  service.getById.mockResolvedValue({ data: d, error: null });
  await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Anulada por un propietario')).toBeTruthy());
  expect(screen.getByText('Motivo:   Exact reason  ')).toBeTruthy();
  expect(screen.getByText('Cantidad descontada del stock: 1')).toBeTruthy();
  expect(screen.getByText('Cantidad descontada del stock: 3')).toBeTruthy();
  expect(screen.getByText('Gasto original')).toBeTruthy();
  expect(screen.getByText(/ya no cuenta en los totales efectivos/)).toBeTruthy();
  expect(screen.queryByText(id(90))).toBeNull();
  expect(screen.queryByText(id(99))).toBeNull();
  expect(screen.queryByText('Reembolsado')).toBeNull();
});
test.each([
  'ACCESS_DENIED',
  'INVALID_INPUT',
  'INVALID_STATUS',
  'CONFLICT',
  'INSUFFICIENT_STOCK',
  'INCOMPLETE_HISTORY',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
] satisfies VoidPurchaseErrorCode[])('void displays safe %s and no false success', async (code) => {
  service.voidPurchase.mockResolvedValue({ data: null, error: voidPurchaseError(code) });
  await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Completada')).toBeTruthy());
  await press('Anular compra');
  await fireEvent.changeText(screen.getByLabelText('Motivo de la anulación'), '  Exact reason  ');
  await press('Confirmar anulación');
  await waitFor(() => expect(screen.getByText(voidPurchaseError(code).message)).toBeTruthy());
  expect(screen.queryByText('Compra anulada en BarberFlow')).toBeNull();
  expect(service.voidPurchase).toHaveBeenCalledTimes(1);
});
test('detail not-found/read retry and safe back fallback never invokes void', async () => {
  service.getById.mockResolvedValueOnce({
    data: null,
    error: { code: 'NOT_FOUND', message: 'Compra no disponible.' },
  });
  await mount(<PurchaseDetailScreen purchaseId={id(4)} />);
  await waitFor(() => expect(screen.getByText('Compra no disponible.')).toBeTruthy());
  await press('Reintentar');
  await waitFor(() => expect(screen.getByText('Completada')).toBeTruthy());
  await press('Volver a compras');
  expect(routerMock.replace).toHaveBeenCalledWith('/purchases');
  expect(service.voidPurchase).not.toHaveBeenCalled();
});
test('hook double-submit shares request, immediate success and exact real captured prefixes', async () => {
  const wait = deferred<VoidPurchaseResult>();
  service.voidPurchase.mockReturnValue(wait.promise);
  const view = await probe();
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  let first!: Promise<VoidPurchaseData>;
  let second!: Promise<VoidPurchaseData>;
  await act(() => {
    first = view.hook.mutateAsync(input());
    second = view.hook.mutateAsync({ ...input(), operationId: id(88) });
    view.hook.reset();
  });
  expect(first).toBe(second);
  await waitFor(() => expect(service.voidPurchase).toHaveBeenCalledTimes(1));
  await act(async () => {
    wait.resolve({ data: voidSaved(), error: null });
    await first;
  });
  expect(view.hook.status).toBe('success');
  await waitFor(() => expect(invalidation).toHaveBeenCalledTimes(2));
  expect(invalidation).toHaveBeenCalledWith(
    { queryKey: ['purchases', businessId] },
    { throwOnError: true },
  );
  expect(invalidation).toHaveBeenCalledWith(
    { queryKey: ['inventory', businessId] },
    { throwOnError: true },
  );
  const cached = view.client.getQueryData(
    purchasesKeys.detail({ businessId, userId: id(5), membershipId: id(8) }, id(4)),
  );
  expect(JSON.stringify(cached)).not.toMatch(/operation_id|reference_id|created_by/);
  await act(async () => {
    await view.hook.retry();
  });
  expect(service.voidPurchase).toHaveBeenCalledTimes(1);
});
test('hook network uncertainty freezes payload/key across reset and explicit retry only', async () => {
  service.voidPurchase.mockResolvedValueOnce({
    data: null,
    error: voidPurchaseError('NETWORK_ERROR'),
  });
  const view = await probe();
  const original = input();
  await act(async () => {
    await expect(view.hook.mutateAsync(original)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
  original.reason = 'changed';
  await act(() => view.hook.reset());
  await act(async () => {
    await expect(view.hook.mutateAsync(original)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  await act(async () => {
    await view.hook.retry();
  });
  expect(service.voidPurchase.mock.calls).toEqual([
    [businessId, input()],
    [businessId, input()],
  ]);
});

test('old hook retry/reset/read-retry closures cannot operate on a new business intention', async () => {
  const view = await probe();
  const stale = view.hook;
  scope(id(77));
  await view.update();
  service.voidPurchase.mockResolvedValueOnce({
    data: null,
    error: voidPurchaseError('INSUFFICIENT_STOCK'),
  });
  await act(async () => {
    await expect(view.hook.mutateAsync(input())).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
  });
  await act(() => stale.reset());
  expect(view.hook.status).toBe('error');
  await act(async () => {
    await expect(stale.retry()).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  expect(service.voidPurchase).toHaveBeenCalledTimes(1);
  await act(async () => {
    await view.hook.mutateAsync({ ...input(), operationId: id(100) });
  });
  expect(view.hook.status).toBe('success');
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  invalidation.mockClear();
  await act(async () => {
    await stale.retryReads();
  });
  expect(invalidation).not.toHaveBeenCalled();
  await act(async () => {
    await expect(stale.retry()).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  expect(service.voidPurchase).toHaveBeenCalledTimes(2);
});
test.each(['business', 'purchase', 'membership', 'user', 'logout', 'unmount', 'aba'] as const)(
  'late hook success after %s cannot publish/invalidate new scope',
  async (change) => {
    const pending = deferred<VoidPurchaseResult>();
    service.voidPurchase.mockReturnValue(pending.promise);
    const view = await probe();
    const invalidate = jest.spyOn(view.client, 'invalidateQueries');
    let promise!: Promise<VoidPurchaseData>;
    await act(() => {
      promise = view.hook.mutateAsync(input());
    });
    const observed = promise.catch((e) => e);
    await waitFor(() => expect(service.voidPurchase).toHaveBeenCalledTimes(1));
    if (change === 'unmount') await view.unmount();
    else {
      if (change === 'business' || change === 'aba') scope(id(77));
      if (change === 'membership') scope(businessId, id(77));
      if (change === 'user') scope(businessId, id(8), 'OWNER', id(77));
      if (change === 'logout')
        jest
          .mocked(useAuth)
          .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
      await view.update(change === 'purchase' ? id(77) : id(4));
      if (change === 'aba') {
        scope();
        await view.update();
      }
    }
    await act(async () => {
      pending.resolve({ data: voidSaved(), error: null });
      expect(await observed).toMatchObject({ code: 'ACCESS_DENIED' });
    });
    expect(invalidate).not.toHaveBeenCalled();
    if (change !== 'unmount') expect(view.hook.status).toBe('idle');
  },
);
test('refresh failure remains transaction success and retryReads never resends void', async () => {
  const view = await probe();
  const invalidate = jest
    .spyOn(view.client, 'invalidateQueries')
    .mockRejectedValue(new Error('read failure'));
  await act(async () => {
    await view.hook.mutateAsync(input());
  });
  await waitFor(() => expect(view.hook.refreshError).toBe(true));
  expect(view.hook.status).toBe('success');
  invalidate.mockResolvedValue();
  await act(async () => {
    await view.hook.retryReads();
  });
  expect(view.hook.status).toBe('success');
  expect(view.hook.refreshError).toBe(false);
  expect(service.voidPurchase).toHaveBeenCalledTimes(1);
});
