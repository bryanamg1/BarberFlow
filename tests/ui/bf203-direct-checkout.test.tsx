import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { router, useLocalSearchParams } from 'expo-router';

import NewSaleRoute from '@/app/(app)/sales/new';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { productsKeys } from '@/features/products/constants/productsKeys';
import { productsService } from '@/features/products/services/productsService';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { servicesService } from '@/features/services/services/servicesService';
import { salesKeys } from '@/features/sales/constants/salesKeys';
import { CheckoutDraftLifecycle } from '@/features/sales/store/CheckoutDraftLifecycle';
import { checkoutError } from '@/features/sales/services/checkoutErrors';
import type { CompleteCheckoutData } from '@/features/sales/types/checkout.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatMoney } from '@/utils/formatMoney';

import {
  context,
  scope,
  state,
  seed,
  id,
  saved,
  serviceRow,
  productRow,
} from './helpers/checkoutFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useLocalSearchParams: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
}));
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  uuid: { v4: jest.fn() },
}));
jest.mock('@/features/appointments/hooks/useAppointmentDetail', () => ({
  useAppointmentDetail: jest.fn(),
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { getById: jest.fn(), listByBusiness: jest.fn() },
}));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { getById: jest.fn(), list: jest.fn() },
}));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: { getByIds: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
// Keep the entire checkout pipeline real; only its external SDK boundary is simulated.
jest.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
const mockRpc = jest.fn();
const envelope = (
  data: CompleteCheckoutData | null = saved(),
  error: { code: string; message: string; details?: string } | null = null,
  status = 200,
) => ({ data, error, status, statusText: 'fixture', count: null });
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  seed();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
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
    status: 'idle',
    data: null,
    error: null,
    isFetching: false,
    refetch: async () => {},
  });
  mockRpc.mockResolvedValue(envelope());
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
function App() {
  return (
    <>
      <CheckoutDraftLifecycle />
      <NewSaleRoute />
    </>
  );
}
const setup = () => renderWithProviders(<App />);
const submit = () => screen.getByRole('button', { name: 'Completar venta' });
const ready = () => waitFor(() => expect(submit()).toBeEnabled());
function deferred() {
  let resolve!: (value: ReturnType<typeof envelope>) => void;
  const promise = new Promise<ReturnType<typeof envelope>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('route composes selector/quantity/summary/discount/payment into one real captured checkout RPC and persisted navigation', async () => {
  const result = saved();
  result.items.push({ ...result.items[1], id: id(11), quantity: 3, line_total: 30 });
  result.sale.subtotal = 140;
  result.sale.discount = 5;
  result.sale.total = 135;
  result.payments[0].amount = 135;
  result.payments[0].payment_method = 'CASH';
  const pending = deferred();
  mockRpc.mockReturnValue(pending.promise);
  const { queryClient } = await setup();
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  await fireEvent.changeText(screen.getByLabelText('Cantidad de producto de línea 2'), '3');
  await fireEvent.changeText(screen.getByLabelText('Descuento global'), '5.00');
  await fireEvent.press(screen.getByRole('button', { name: 'Método de pago: Efectivo' }));
  expect(screen.getByText(`Total estimado: ${formatMoney('135.00', 'ARS')}`)).toBeTruthy();
  expect(
    state()
      .draft?.items.filter((line) => line.itemType === 'PRODUCT')
      .map((line) => [line.lineId, line.quantity]),
  ).toEqual([
    ['local-product', 1],
    [id(90), 3],
  ]);
  const actor = { ...scope, role: 'OWNER' as const };
  const changed = [
    salesKeys.detail(actor, id(4)),
    productsKeys.list(scope, { page: 2, pageSize: 25, status: 'inactive' }),
    inventoryKeys.productStock(scope.businessId, id(3)),
  ];
  const untouched = [
    appointmentsKeys.detail(actor, id(9)),
    salesKeys.detail({ ...actor, businessId: id(77) }, id(4)),
  ];
  [...changed, ...untouched].forEach((key) => queryClient.setQueryData(key, 'cached'));
  await fireEvent.press(submit());
  await fireEvent.press(submit());
  await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
  const capture = state().submission!.capture;
  expect(Object.isFrozen(capture.input)).toBe(true);
  expect(mockRpc).toHaveBeenCalledWith('complete_checkout', {
    p_business_id: scope.businessId,
    p_operation_id: id(1),
    p_appointment_id: null,
    p_client_id: null,
    p_discount_amount: '5.00',
    p_payment_method: 'CASH',
    p_items: [
      { itemType: 'SERVICE', itemId: id(2), quantity: 1 },
      { itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
      { itemType: 'PRODUCT', itemId: id(3), quantity: 3 },
    ],
  });
  expect(screen.getByLabelText('Cantidad de producto de línea 2')).toBeDisabled();
  expect(screen.getByLabelText('Descuento global')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Método de pago: Efectivo' })).toBeDisabled();
  await act(() => {
    pending.resolve(envelope(result));
  });
  await screen.findByText('Venta confirmada');
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/sales/[id]',
    params: { id: result.sale.id },
  });
  expect(state().draft).toBeNull();
  changed.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  untouched.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false));
  expect(jest.mocked(useAppointmentDetail).mock.calls.every(([value]) => value === null)).toBe(
    true,
  );
});

test.each(['quantity', 'stock', 'discount', 'payment', 'catalog'])(
  '%s shared guard blocks the real repository boundary in direct mode',
  async (mode) => {
    if (mode === 'quantity') state().editLineText(scope, id(1), 'local-product', 'quantity', '0');
    if (mode === 'stock')
      jest
        .mocked(inventoryService.getProductStock)
        .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '0' }], error: null });
    if (mode === 'discount') state().patchDraft(scope, id(1), { discountAmount: '111.00' });
    if (mode === 'payment') seed(false);
    if (mode === 'catalog')
      jest
        .mocked(productsService.getById)
        .mockResolvedValue({ data: { ...productRow, is_active: false }, error: null });
    await setup();
    await screen.findByText('Venta directa');
    await waitFor(() =>
      expect(screen.queryByText('Consultando referencias o stock del resumen…')).toBeNull(),
    );
    expect(submit()).toBeDisabled();
    await fireEvent.press(submit());
    expect(mockRpc).not.toHaveBeenCalled();
    expect(state().submission).toBeNull();
  },
);

test('unknown SDK outcome locks edits; rerender and retry reuse captured key/payload and preserve success despite refresh failure', async () => {
  mockRpc
    .mockRejectedValueOnce(new Error('private transport detail'))
    .mockResolvedValueOnce(envelope());
  const { rerender, queryClient } = await setup();
  await ready();
  await fireEvent.press(submit());
  await screen.findByRole('button', { name: 'Reintentar intención original' });
  expect(screen.queryByText('private transport detail')).toBeNull();
  const capture = state().submission!.capture;
  expect(screen.getByRole('button', { name: 'Cancelar venta' })).toBeDisabled();
  expect(state().patchDraft(scope, id(1), { discountAmount: '20.00' })).toBe(false);
  await rerender(<App />);
  jest.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('refresh failed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar intención original' }));
  await screen.findByText('Venta confirmada');
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]);
  expect(capture.input.operationId).toBe(id(1));
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
});

test('safe insufficient-stock backend failure stays in the shared form with original intention', async () => {
  mockRpc.mockResolvedValue(
    envelope(
      null,
      { code: 'PT409', details: 'INSUFFICIENT_STOCK', message: 'private database detail' },
      409,
    ),
  );
  await setup();
  await ready();
  await fireEvent.press(submit());
  await screen.findByText(checkoutError('INSUFFICIENT_STOCK').message);
  expect(screen.queryByText('private database detail')).toBeNull();
  expect(state().draft?.operationId).toBe(id(1));
  expect(router.replace).not.toHaveBeenCalled();
});

test.each(['user', 'business', 'membership', 'logout'])(
  '%s change rejects late success without navigation, old cache invalidation or new draft clearing',
  async (mode) => {
    const pending = deferred();
    mockRpc.mockReturnValue(pending.promise);
    const { rerender, queryClient } = await setup();
    await ready();
    const invalidation = jest.spyOn(queryClient, 'invalidateQueries');
    await fireEvent.press(submit());
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    if (mode === 'user') context(id(50));
    if (mode === 'business') context(scope.userId, id(50));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(50));
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await rerender(<App />);
    const replacement = state().draft;
    await act(() => {
      pending.resolve(envelope());
    });
    expect(state().draft).toBe(replacement);
    expect(router.replace).not.toHaveBeenCalled();
    expect(invalidation).not.toHaveBeenCalled();
  },
);

test('a captured appointment intention cannot be submitted or replaced by the direct composition', async () => {
  seed(true, id(9));
  const capture = state().captureIntent(scope, id(1));
  const draft = state().draft;
  await setup();
  expect(screen.getByText('Hay otra venta en curso')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Completar venta' })).toBeNull();
  expect(state().draft).toBe(draft);
  expect(state().submission?.capture).toBe(capture);
  expect(mockRpc).not.toHaveBeenCalled();
});
