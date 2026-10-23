import { defaultScheduler, notifyManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { router } from 'expo-router';
import { useEffect } from 'react';

import NewSaleRoute from '@/app/(app)/sales/new';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { servicesService } from '@/features/services/services/servicesService';
import { productsService } from '@/features/products/services/productsService';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { useCompleteCheckout } from '@/features/sales/hooks/useCompleteCheckout';
import { checkoutService } from '@/features/sales/services/checkoutService';
import { checkoutError } from '@/features/sales/services/checkoutErrors';
import { CheckoutScreen } from '@/features/sales/screens/CheckoutScreen';
import type { CompleteCheckoutResult } from '@/features/sales/types/checkout.types';
import { salesKeys } from '@/features/sales/constants/salesKeys';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { renderWithProviders } from '@/test/renderWithProviders';
import {
  id,
  scope,
  state,
  context,
  seed,
  saved,
  serviceRow,
  productRow,
  at,
} from './helpers/checkoutFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useIsFocused: () => true,
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  uuid: { v4: jest.fn() },
}));
jest.mock('@/features/appointments/hooks/useAppointmentDetail', () => ({
  useAppointmentDetail: jest.fn(),
}));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { getById: jest.fn(), list: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { getById: jest.fn(), listByBusiness: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/features/sales/services/checkoutService', () => ({
  checkoutService: { complete: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK or extra financial write');
});
let latest: ReturnType<typeof useCompleteCheckout>;
function Probe() {
  const value = useCompleteCheckout();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const service = jest.mocked(checkoutService.complete);
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  onlineManager.setOnline(true);
  context();
  seed();
  jest.mocked(uuid.v4).mockReturnValue(id(90));
  jest.mocked(servicesService.getById).mockResolvedValue({ data: serviceRow, error: null });
  jest.mocked(servicesService.list).mockResolvedValue({
    data: { items: [serviceRow], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  jest.mocked(productsService.getById).mockResolvedValue({ data: productRow, error: null });
  jest.mocked(productsService.listByBusiness).mockResolvedValue({
    data: { items: [productRow], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  jest
    .mocked(inventoryService.getProductStock)
    .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '10' }], error: null });
  jest.mocked(useAppointmentDetail).mockReturnValue({
    status: 'success',
    data: {
      id: id(9),
      business_id: scope.businessId,
      client_id: id(11),
      barber_member_id: scope.membershipId,
      status: 'CONFIRMED',
      start_at: at,
      end_at: at,
      notes: null,
      created_by: scope.userId,
      created_at: at,
      updated_at: at,
      appointment_services: [],
    },
    error: null,
    isFetching: false,
    refetch: async () => {},
  });
  service.mockResolvedValue({ data: saved(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
});
const setup = () => renderWithProviders(<Probe />);
const ready = () => waitFor(() => expect(latest.eligible).toBe(true));
function deferred() {
  let resolve!: (value: CompleteCheckoutResult) => void;
  const promise = new Promise<CompleteCheckoutResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('capture precedes RPC; double-submit shares one promise and exact immutable input', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  await setup();
  await ready();
  let first!: ReturnType<typeof latest.submit>, second!: ReturnType<typeof latest.submit>;
  await act(() => {
    first = latest.submit();
    second = latest.submit();
  });
  await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  expect(first).toBe(second);
  const capture = state().submission!.capture;
  expect(Object.isFrozen(capture.input.items)).toBe(true);
  expect(service).toHaveBeenCalledWith(scope.businessId, capture.input);
  expect(capture.input.operationId).toBe(id(1));
  expect(capture.input.items.map((x) => Object.keys(x))).toEqual([
    ['itemType', 'itemId', 'quantity'],
    ['itemType', 'itemId', 'quantity'],
  ]);
  expect(state().patchDraft(scope, id(1), { discountAmount: '20.00' })).toBe(false);
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
    await first;
  });
  expect(state().draft).toBeNull();
  expect(latest.status).toBe('success');
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
});
test.each(['NETWORK_ERROR', 'UNKNOWN_ERROR', 'RETRYABLE_ERROR'] as const)(
  'uncertain %s keeps original capture/key, only explicit retry sends again',
  async (code) => {
    service.mockResolvedValueOnce({ data: null, error: checkoutError(code) });
    await setup();
    await ready();
    await act(async () => {
      await latest.submit().catch(() => undefined);
    });
    const capture = state().submission!.capture;
    expect(state().submission?.status).toBe('uncertain');
    expect(latest.status).toBe('uncertain');
    expect(router.replace).not.toHaveBeenCalled();
    expect(service).toHaveBeenCalledTimes(1);
    await act(async () => {
      await latest.retry();
    });
    expect(service).toHaveBeenCalledTimes(2);
    expect(service.mock.calls[0][1]).toBe(capture.input);
    expect(service.mock.calls[1][1]).toBe(capture.input);
    expect(state().draft).toBeNull();
  },
);
test('known rejection retains intent; explicit edit adopts new key and preserves values/lines', async () => {
  service.mockResolvedValueOnce({ data: null, error: checkoutError('INSUFFICIENT_STOCK') });
  await setup();
  await ready();
  await act(async () => {
    await latest.submit().catch(() => undefined);
  });
  expect(latest.status).toBe('error');
  expect(state().draft?.operationId).toBe(id(1));
  expect(router.replace).not.toHaveBeenCalled();
  await act(() => {
    expect(latest.editRejected(id(91))).toBe(true);
  });
  expect(state().draft?.operationId).toBe(id(91));
  expect(state().draft?.items).toHaveLength(2);
  expect(state().draft?.paymentMethod).toBe('BANK_TRANSFER');
  expect(state().submission).toBeNull();
  await ready();
  expect(service).toHaveBeenCalledTimes(1);
});
test.each(['payment', 'discount', 'stock', 'catalog', 'empty'])(
  'ineligible %s state prevents capture and RPC',
  async (mode) => {
    if (mode === 'payment') seed(false);
    if (mode === 'discount') state().patchDraft(scope, id(1), { discountAmount: '999.00' });
    if (mode === 'stock')
      jest
        .mocked(inventoryService.getProductStock)
        .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '0' }], error: null });
    if (mode === 'catalog')
      jest
        .mocked(servicesService.getById)
        .mockResolvedValue({ data: { ...serviceRow, is_active: false }, error: null });
    if (mode === 'empty') {
      state().removeLine(scope, id(1), 'local-service');
      state().removeLine(scope, id(1), 'local-product');
    }
    await setup();
    await act(async () => {
      await latest.submit().catch(() => undefined);
    });
    expect(service).not.toHaveBeenCalled();
    expect(state().submission).toBeNull();
    expect(latest.eligible).toBe(false);
  },
);
test('appointment context is preserved exactly; client remains server-derived, no auto-copy', async () => {
  seed(true, id(9));
  const value = saved();
  value.sale.appointment_id = id(9);
  value.sale.client_id = id(11);
  service.mockResolvedValue({ data: value, error: null });
  await setup();
  await ready();
  await act(async () => {
    await latest.submit();
  });
  expect(service.mock.calls[0][1].appointmentId).toBe(id(9));
  expect(service.mock.calls[0][1].clientId).toBeNull();
  expect(service.mock.calls[0][1].items).toHaveLength(2);
});
test('zero total still sends selected method and accepts empty persisted payments', async () => {
  state().patchDraft(scope, id(1), { discountAmount: '110.00' });
  const value = saved();
  value.sale.discount = 110;
  value.sale.total = 0;
  value.payments = [];
  service.mockResolvedValue({ data: value, error: null });
  await setup();
  await ready();
  await act(async () => {
    await latest.submit();
  });
  expect(service.mock.calls[0][1].discountAmount).toBe('110.00');
  expect(service.mock.calls[0][1].paymentMethod).toBe('BANK_TRANSFER');
  expect(latest.data?.payments).toEqual([]);
  expect(state().draft).toBeNull();
});
test('confirmed replay survives invalidation and navigation failures without another write', async () => {
  const value = saved();
  value.sale.status = 'VOIDED';
  value.sale.appointment_id = id(9);
  service.mockResolvedValue({ data: value, error: null });
  const { queryClient } = await setup();
  await ready();
  const invalidation = jest
    .spyOn(queryClient, 'invalidateQueries')
    .mockRejectedValue(new Error('refresh'));
  jest.mocked(router.replace).mockImplementationOnce(() => {
    throw new Error('navigation');
  });
  await act(async () => {
    await latest.submit();
  });
  expect(latest.status).toBe('success');
  expect(latest.data).toBe(value);
  expect(state().draft).toBeNull();
  expect(service).toHaveBeenCalledTimes(1);
  expect(invalidation.mock.calls.map((x) => x[0]?.queryKey)).toEqual(
    expect.arrayContaining([
      ['inventory', scope.businessId],
      ['products', scope.businessId],
      ['appointments', scope.businessId],
    ]),
  );
});
test('same-scope new draft survives late success and receives no stale navigation', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  const { queryClient } = await setup();
  const invalidation = jest.spyOn(queryClient, 'invalidateQueries');
  await ready();
  let request!: ReturnType<typeof latest.submit>;
  await act(() => {
    request = latest.submit();
  });
  await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  await act(() => {
    state().setScope(null);
    state().setScope(scope);
    state().startDraft(scope, id(92));
  });
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
    await request.catch(() => undefined);
  });
  expect(state().draft?.operationId).toBe(id(92));
  expect(router.replace).not.toHaveBeenCalled();
  expect(invalidation).not.toHaveBeenCalled();
});

test('BF198 confirmed submit invalidates only captured Sale identity and affected stock, never another actor', async () => {
  const { queryClient } = await setup();
  await ready();
  const own = salesKeys.detail({ ...scope, role: 'OWNER' }, id(4));
  const other = salesKeys.detail({ ...scope, role: 'BARBER' }, id(4));
  const stock = inventoryKeys.productStock(scope.businessId, id(3));
  const unrelated = inventoryKeys.productStock(scope.businessId, id(39));
  for (const key of [own, other, stock, unrelated]) queryClient.setQueryData(key, 'existing');
  await act(async () => {
    await latest.submit();
  });
  expect(queryClient.getQueryState(own)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryData(own)).toBe('existing');
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(stock)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
});

test('BF198 SERVICE-only direct sale leaves stock and appointment caches intact', async () => {
  state().removeLine(scope, id(1), 'local-product');
  const result = saved();
  result.items = result.items.filter((line) => line.item_type === 'SERVICE');
  service.mockResolvedValue({ data: result, error: null });
  const { queryClient } = await setup();
  await ready();
  const stock = inventoryKeys.productStock(scope.businessId, id(3));
  const appointment = appointmentsKeys.detail({ ...scope, role: 'OWNER' }, id(9));
  for (const key of [stock, appointment]) queryClient.setQueryData(key, 'existing');
  await act(async () => {
    await latest.submit();
  });
  expect(queryClient.getQueryState(stock)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(appointment)?.isInvalidated).toBe(false);
  expect(latest.status).toBe('success');
});

test('BF198 unresolved cache refresh never delays navigation, restores draft or sends another checkout', async () => {
  const { queryClient } = await setup();
  await ready();
  jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    await latest.submit();
  });
  expect(latest.status).toBe('success');
  expect(state().draft).toBeNull();
  expect(service).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
});
test('unmount pending becomes uncertain and remount retry uses exact retained capture', async () => {
  const pending = deferred();
  service.mockReturnValueOnce(pending.promise);
  const view = await setup();
  await ready();
  let request!: ReturnType<typeof latest.submit>;
  await act(() => {
    request = latest.submit();
  });
  await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  const capture = state().submission!.capture;
  await view.unmount();
  expect(state().submission?.status).toBe('uncertain');
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
    await request.catch(() => undefined);
  });
  await setup();
  expect(latest.status).toBe('uncertain');
  await act(async () => {
    await latest.retry();
  });
  expect(service.mock.calls[1][1]).toBe(capture.input);
  expect(state().draft).toBeNull();
});
test.each(['user', 'business', 'membership', 'logout', 'barber'])(
  'context %s invalidates old attempt and forbids stale write/navigation',
  async (mode) => {
    const pending = deferred();
    service.mockReturnValue(pending.promise);
    const { rerender } = await setup();
    await ready();
    let request!: ReturnType<typeof latest.submit>;
    await act(() => {
      request = latest.submit();
    });
    await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
    const oldSubmit = latest.submit;
    if (mode === 'user') context(id(50));
    if (mode === 'business') context(scope.userId, id(50));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(50));
    if (mode === 'barber') context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await act(() => {
      state().setScope(null);
    });
    await rerender(<Probe />);
    await act(async () => {
      pending.resolve({ data: saved(), error: null });
      await request.catch(() => undefined);
      await oldSubmit().catch(() => undefined);
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(service).toHaveBeenCalledTimes(1);
    expect(latest.eligible).toBe(false);
  },
);
test('offline mutation is not parked or automatically retried when connectivity returns', async () => {
  service.mockResolvedValueOnce({ data: null, error: checkoutError('NETWORK_ERROR') });
  await setup();
  await ready();
  await act(() => {
    onlineManager.setOnline(false);
  });
  await act(async () => {
    await latest.submit().catch(() => undefined);
  });
  expect(service).toHaveBeenCalledTimes(1);
  await act(() => {
    onlineManager.setOnline(true);
  });
  expect(service).toHaveBeenCalledTimes(1);
  expect(latest.status).toBe('uncertain');
});
test('route composes existing fields; screen double click sends once and success uses persisted id', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  await renderWithProviders(<NewSaleRoute />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Completar venta' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Descuento global')).toBeTruthy();
  expect(screen.getByText('Resumen estimado')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Método de pago' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Completar venta' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Completar venta' }));
  expect(service).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cancelar venta' })).toBeDisabled();
  await act(async () => {
    pending.resolve({ data: saved(), error: null });
  });
  await screen.findByText('Venta confirmada');
  expect(state().draft).toBeNull();
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
});
test('new linked screen derives client read-only and starts with no copied appointment services', async () => {
  state().clearDraft(scope, id(1));
  await renderWithProviders(<CheckoutScreen appointmentId={id(9)} clientId={id(99)} />);
  await screen.findByText(
    `Cliente de la cita: ${id(11)}. Los servicios se seleccionan explícitamente.`,
  );
  expect(state().draft?.appointmentId).toBe(id(9));
  expect(state().draft?.clientId).toBeNull();
  expect(state().draft?.items).toEqual([]);
  expect(service).not.toHaveBeenCalled();
});
test('BARBER and invalid route context never create a draft or show submit', async () => {
  state().clearDraft(scope, id(1));
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  const { rerender } = await renderWithProviders(<CheckoutScreen />);
  expect(screen.queryByRole('button', { name: 'Completar venta' })).toBeNull();
  expect(state().draft).toBeNull();
  context();
  await rerender(<CheckoutScreen validContext={false} />);
  expect(screen.getByText('El contexto de la venta no es válido.')).toBeTruthy();
  expect(state().draft).toBeNull();
});
