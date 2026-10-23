import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { router, useLocalSearchParams } from 'expo-router';

import NewSaleRoute from '@/app/(app)/sales/new';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { productsService } from '@/features/products/services/productsService';
import { servicesService } from '@/features/services/services/servicesService';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { ProductsScreen } from '@/features/products/screens/ProductsScreen';
import { DirectSaleScreen } from '@/features/sales/screens/DirectSaleScreen';
import { CheckoutDraftLifecycle } from '@/features/sales/store/CheckoutDraftLifecycle';
import { checkoutService } from '@/features/sales/services/checkoutService';
import { checkoutError } from '@/features/sales/services/checkoutErrors';
import type { CompleteCheckoutResult } from '@/features/sales/types/checkout.types';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { salesKeys } from '@/features/sales/constants/salesKeys';
import { renderWithProviders } from '@/test/renderWithProviders';
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
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { getById: jest.fn(), list: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { getById: jest.fn(), listByBusiness: jest.fn() },
}));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: { getByIds: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/features/sales/services/checkoutService', () => ({
  checkoutService: { complete: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No parallel persistence or real SDK');
});
const service = jest.mocked(checkoutService.complete);
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
  service.mockResolvedValue({ data: saved(), error: null });
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
  let resolve!: (value: CompleteCheckoutResult) => void;
  const promise = new Promise<CompleteCheckoutResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('Products OWNER entry opens only shared /sales/new; BARBER has no sale entry', async () => {
  const { rerender } = await renderWithProviders(<ProductsScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Nueva venta' }));
  expect(router.push).toHaveBeenCalledWith('/sales/new');
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  await rerender(<ProductsScreen />);
  expect(screen.queryByRole('button', { name: 'Nueva venta' })).toBeNull();
});
test('fresh direct entry initializes current scope, no appointment/client/default payment and no lines', async () => {
  state().clearDraft(scope, id(1));
  await setup();
  await screen.findByText('Venta directa');
  expect(state().scope).toEqual(scope);
  expect(state().draft).toMatchObject({
    operationId: id(90),
    appointmentId: null,
    clientId: null,
    items: [],
    discountAmount: '0.00',
  });
  expect(state().draft?.paymentMethod).toBeUndefined();
  expect(submit()).toBeDisabled();
  expect(service).not.toHaveBeenCalled();
  expect(jest.mocked(useAppointmentDetail).mock.calls.every(([value]) => value === null)).toBe(
    true,
  );
});
test('same direct intention survives rerender with its key, values and independent lines', async () => {
  const draft = state().draft;
  const { rerender } = await setup();
  await ready();
  await rerender(<App />);
  expect(state().draft).toBe(draft);
  expect(uuid.v4).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Servicios del checkout' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Productos del checkout' })).toBeTruthy();
  expect(screen.getByText('Resumen estimado')).toBeTruthy();
  expect(screen.getByLabelText('Descuento global')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Método de pago' })).toBeTruthy();
});
test.each(['editable', 'pending', 'uncertain'])(
  'direct route never leaks or discards an existing %s appointment intent',
  async (mode) => {
    seed(true, id(9));
    const draft = state().draft;
    if (mode !== 'editable') {
      const capture = state().captureIntent(scope, id(1))!;
      if (mode === 'uncertain') state().settleCapture(capture, 'uncertain');
    }
    const existing = state().submission;
    await setup();
    expect(screen.getByText('Hay otra venta en curso')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Completar venta' })).toBeNull();
    expect(state().draft).toBe(draft);
    expect(state().submission).toBe(existing);
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar venta en curso' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/sales/new',
      params: { appointmentId: id(9) },
    });
    expect(service).not.toHaveBeenCalled();
    expect(useAppointmentDetail).not.toHaveBeenCalled();
  },
);
test('fresh optional client reference is preserved; a different explicit client cannot overwrite an intent', async () => {
  state().clearDraft(scope, id(1));
  jest.mocked(useLocalSearchParams).mockReturnValue({ clientId: id(11) });
  const { rerender } = await setup();
  await screen.findByText(`Cliente: ${id(11)}`);
  const draft = state().draft;
  expect(draft?.clientId).toBe(id(11));
  jest.mocked(useLocalSearchParams).mockReturnValue({ clientId: id(12) });
  await rerender(<App />);
  expect(screen.getByText('Hay otra venta en curso')).toBeTruthy();
  expect(state().draft).toBe(draft);
  await fireEvent.press(screen.getByRole('button', { name: 'Continuar venta en curso' }));
  expect(router.replace).toHaveBeenCalledWith('/sales/new');
});
test('shared add controls keep repeated SERVICE and PRODUCT lines independent', async () => {
  state().clearDraft(scope, id(1));
  await setup();
  await screen.findByRole('button', { name: 'Agregar servicio: Corte' });
  jest
    .mocked(uuid.v4)
    .mockReturnValueOnce(id(91))
    .mockReturnValueOnce(id(92))
    .mockReturnValueOnce(id(93))
    .mockReturnValueOnce(id(94));
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar servicio: Corte' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar servicio: Corte' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  expect(state().draft?.items.map((line) => line.itemType)).toEqual([
    'SERVICE',
    'SERVICE',
    'PRODUCT',
    'PRODUCT',
  ]);
  expect(new Set(state().draft?.items.map((line) => line.lineId)).size).toBe(4);
  expect(state().draft?.items.every((line) => line.quantity === 1)).toBe(true);
  expect(submit()).toBeDisabled();
});
test.each(['empty', 'stock', 'discount', 'payment', 'catalog', 'quantity'])(
  '%s direct checkout cannot call persistence',
  async (mode) => {
    if (mode === 'empty') {
      state().removeLine(scope, id(1), 'local-service');
      state().removeLine(scope, id(1), 'local-product');
    }
    if (mode === 'stock')
      jest
        .mocked(inventoryService.getProductStock)
        .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '0' }], error: null });
    if (mode === 'discount') state().patchDraft(scope, id(1), { discountAmount: '111.00' });
    if (mode === 'payment') seed(false);
    if (mode === 'catalog')
      jest.mocked(productsService.getById).mockResolvedValue({
        data: null,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'Producto no disponible.' },
      });
    if (mode === 'quantity') state().editLineText(scope, id(1), 'local-product', 'quantity', '0');
    await setup();
    await screen.findByText('Venta directa');
    await waitFor(() =>
      expect(screen.queryByText('Consultando referencias o stock del resumen…')).toBeNull(),
    );
    expect(submit()).toBeDisabled();
    await fireEvent.press(submit());
    expect(service).not.toHaveBeenCalled();
  },
);
test('direct submit reuses captured pipeline and BF198 policy, exact optional client and no appointment effect', async () => {
  const { queryClient } = await setup();
  await ready();
  const saleKey = salesKeys.detail({ ...scope, role: 'OWNER' }, id(4));
  const stockKey = inventoryKeys.productStock(scope.businessId, id(3));
  const appointmentKey = appointmentsKeys.detail({ ...scope, role: 'OWNER' }, id(9));
  for (const key of [saleKey, stockKey, appointmentKey]) queryClient.setQueryData(key, 'cached');
  await fireEvent.press(submit());
  await screen.findByText('Venta confirmada');
  expect(service).toHaveBeenCalledTimes(1);
  expect(service.mock.calls[0][1]).toMatchObject({
    operationId: id(1),
    appointmentId: null,
    clientId: null,
    paymentMethod: 'BANK_TRANSFER',
    discountAmount: '0.00',
  });
  expect(state().draft).toBeNull();
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
  expect(queryClient.getQueryState(saleKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(stockKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(appointmentKey)?.isInvalidated).toBe(false);
});
test('SERVICE-only direct checkout does not invalidate stock', async () => {
  state().removeLine(scope, id(1), 'local-product');
  const result = saved();
  result.items = result.items.filter((line) => line.item_type === 'SERVICE');
  service.mockResolvedValue({ data: result, error: null });
  const { queryClient } = await setup();
  await ready();
  const key = inventoryKeys.productStock(scope.businessId, id(3));
  queryClient.setQueryData(key, 'cached');
  await fireEvent.press(submit());
  await screen.findByText('Venta confirmada');
  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
});
test('pending direct intention prevents editing, reset and repeated submission; errors preserve original values', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  await setup();
  await ready();
  await fireEvent.press(submit());
  await fireEvent.press(submit());
  const capture = state().submission!.capture;
  expect(submit()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar venta' })).toBeDisabled();
  expect(state().clearDraft(scope, id(1))).toBe(false);
  expect(state().patchDraft(scope, id(1), { discountAmount: '1.00' })).toBe(false);
  await act(() => {
    pending.resolve({ data: null, error: checkoutError('INSUFFICIENT_STOCK') });
  });
  await screen.findByText(checkoutError('INSUFFICIENT_STOCK').message);
  expect(state().draft?.operationId).toBe(capture.input.operationId);
  expect(service).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
});
test('uncertain rerender retains exact capture; explicit retry uses original key and input without appointment', async () => {
  service.mockResolvedValueOnce({ data: null, error: checkoutError('NETWORK_ERROR') });
  const { rerender } = await setup();
  await ready();
  await fireEvent.press(submit());
  await screen.findByRole('button', { name: 'Reintentar intención original' });
  const capture = state().submission!.capture;
  await rerender(<App />);
  expect(state().submission?.capture).toBe(capture);
  expect(screen.getByRole('button', { name: 'Cancelar venta' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar intención original' }));
  await screen.findByText('Venta confirmada');
  expect(service).toHaveBeenCalledTimes(2);
  expect(service.mock.calls[1][1]).toBe(capture.input);
  expect(capture.input.appointmentId).toBeNull();
});
test.each(['user', 'business', 'membership', 'logout'])(
  'direct context %s change prevents late success navigation and old intent reuse',
  async (mode) => {
    const pending = deferred();
    service.mockReturnValue(pending.promise);
    const { rerender } = await setup();
    await ready();
    await fireEvent.press(submit());
    if (mode === 'user') context(id(50));
    if (mode === 'business') context(scope.userId, id(50));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(50));
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    await rerender(<App />);
    await act(() => {
      pending.resolve({ data: saved(), error: null });
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(state().draft?.operationId).not.toBe(id(1));
    expect(service).toHaveBeenCalledTimes(1);
  },
);
test('BARBER, invalid client parameter and unavailable business never initialize a direct intent', async () => {
  state().clearDraft(scope, id(1));
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  const { rerender } = await setup();
  expect(screen.queryByRole('button', { name: 'Completar venta' })).toBeNull();
  expect(state().draft).toBeNull();
  context();
  jest.mocked(useLocalSearchParams).mockReturnValue({ clientId: ['bad', 'array'] });
  await rerender(<App />);
  expect(screen.getByText('El contexto de la venta no es válido.')).toBeTruthy();
  expect(state().draft).toBeNull();
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await rerender(<DirectSaleScreen />);
  expect(screen.queryByRole('button', { name: 'Completar venta' })).toBeNull();
  expect(service).not.toHaveBeenCalled();
});
