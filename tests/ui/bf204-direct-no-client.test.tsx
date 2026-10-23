import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { router, useLocalSearchParams } from 'expo-router';

import NewSaleRoute from '@/app/(app)/sales/new';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import { productsService } from '@/features/products/services/productsService';
import { servicesService } from '@/features/services/services/servicesService';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { salesKeys } from '@/features/sales/constants/salesKeys';
import { CheckoutDraftLifecycle } from '@/features/sales/store/CheckoutDraftLifecycle';
import { SaleDetailScreen } from '@/features/sales/screens/SaleDetailScreen';
import { checkoutError } from '@/features/sales/services/checkoutErrors';
import { renderWithProviders } from '@/test/renderWithProviders';

import {
  context,
  scope,
  state,
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
jest.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock('@/features/sales/repositories/salesRepository', () => ({
  salesRepository: { getById: (...args: unknown[]) => mockRead(...args) },
}));
const mockRpc = jest.fn(),
  mockRead = jest.fn();
function persisted(clientId: string | null = null, operationId = id(1)) {
  const value = saved();
  value.sale.client_id = clientId;
  value.sale.operation_id = operationId;
  value.items = value.items.filter((line) => line.item_type === 'PRODUCT');
  value.sale.subtotal = value.sale.total = value.payments[0].amount = 10;
  return value;
}
let current = persisted();
const envelope = () => ({
  data: current,
  error: null,
  status: 200,
  count: null,
  statusText: 'fixture',
});
function direct(clientId: string | null = null) {
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, id(1), { clientId });
  state().addLine(
    scope,
    id(1),
    { lineId: 'p', itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
    scope.businessId,
  );
  state().patchDraft(scope, id(1), { paymentMethod: 'BANK_TRANSFER' });
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  direct();
  current = persisted();
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
  mockRpc.mockImplementation(async () => envelope());
  mockRead.mockImplementation(async () => ({
    data: { ...current.sale, sale_items: current.items, payments: current.payments },
    error: null,
    status: 200,
  }));
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

test.each([null, id(60)])(
  'direct client=%s traverses shared write, selective cache and persisted detail without creating clients',
  async (clientId) => {
    direct(clientId);
    current = persisted(clientId);
    jest.mocked(useLocalSearchParams).mockReturnValue(clientId === null ? {} : { clientId });
    const { queryClient, rerender } = await setup();
    await ready();
    expect(screen.getByText(`Cliente: ${clientId ?? 'Sin cliente'}`)).toBeTruthy();
    const actor = { ...scope, role: 'OWNER' as const };
    const saleKey = salesKeys.detail(actor, id(4));
    const stockKey = inventoryKeys.productStock(scope.businessId, id(3));
    const appointmentKey = appointmentsKeys.detail(actor, id(9));
    const stats = clientsKeys.stats(scope.businessId, id(60), scope.userId, 'OWNER');
    [stockKey, appointmentKey, stats].forEach((key) => queryClient.setQueryData(key, 'cached'));
    queryClient.setQueryData(saleKey, {
      ...current.sale,
      sale_items: current.items,
      payments: current.payments,
    });
    await fireEvent.press(submit());
    await screen.findByText('Venta confirmada');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('complete_checkout');
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_business_id: scope.businessId,
      p_operation_id: id(1),
      p_client_id: clientId,
      p_appointment_id: null,
    });
    expect(queryClient.getQueryState(stats)?.isInvalidated).toBe(clientId !== null);
    expect(queryClient.getQueryState(saleKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(stockKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(appointmentKey)?.isInvalidated).toBe(false);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/sales/[id]', params: { id: id(4) } });
    await rerender(
      <>
        <CheckoutDraftLifecycle />
        <SaleDetailScreen saleId={id(4)} />
      </>,
    );
    await screen.findByText(`Cliente: ${clientId ?? 'Sin cliente'}`);
    expect(screen.getByText('Shampoo histórico')).toBeTruthy();
    expect(mockRead).toHaveBeenCalledWith(scope.businessId, id(4));
    expect(mockRpc).toHaveBeenCalledTimes(1);
  },
);

test('fresh route starts genuinely without client, then selecting a product and explicit payment enables sale', async () => {
  state().clearDraft(scope, id(1));
  current = persisted(null, id(90));
  await setup();
  await screen.findByText('Cliente: Sin cliente');
  expect(state().draft).toMatchObject({ clientId: null, appointmentId: null, items: [] });
  expect(submit()).toBeDisabled();
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar producto: Shampoo' }));
  expect(submit()).toBeDisabled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Método de pago: Transferencia bancaria' }),
  );
  await ready();
  await fireEvent.press(submit());
  await screen.findByText('Venta confirmada');
  expect(mockRpc.mock.calls[0][1].p_client_id).toBeNull();
  expect(mockRpc.mock.calls[0][1].p_appointment_id).toBeNull();
});

test('uncertain no-client capture cannot gain a client and retries exact same key and payload', async () => {
  mockRpc.mockRejectedValueOnce(new Error('transport private'));
  const { rerender } = await setup();
  await ready();
  await fireEvent.press(submit());
  await screen.findByRole('button', { name: 'Reintentar intención original' });
  const capture = state().submission!.capture;
  expect(capture.input.clientId).toBeNull();
  expect(Object.isFrozen(capture.input)).toBe(true);
  expect(state().startDraft(scope, id(50), { clientId: id(60) })).toBe(false);
  jest.mocked(useLocalSearchParams).mockReturnValue({ clientId: id(60) });
  await rerender(<App />);
  expect(screen.getByText('Hay otra venta en curso')).toBeTruthy();
  expect(state().submission?.capture).toBe(capture);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  await rerender(<App />);
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar intención original' }));
  await screen.findByText('Venta confirmada');
  expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]);
  expect(mockRpc.mock.calls[1][1].p_operation_id).toBe(id(1));
  expect(mockRpc.mock.calls[1][1].p_client_id).toBeNull();
});

test('a direct URL without client preserves a compatible draft that already has a real client', async () => {
  direct(id(60));
  current = persisted(id(60));
  await setup();
  await ready();
  expect(screen.getByText(`Cliente: ${id(60)}`)).toBeTruthy();
  await fireEvent.press(submit());
  await screen.findByText('Venta confirmada');
  expect(mockRpc.mock.calls[0][1].p_client_id).toBe(id(60));
});

test.each(['stock', 'discount', 'quantity', 'payment', 'empty'])(
  'no-client does not bypass %s eligibility',
  async (mode) => {
    if (mode === 'stock')
      jest
        .mocked(inventoryService.getProductStock)
        .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '0' }], error: null });
    if (mode === 'discount') state().patchDraft(scope, id(1), { discountAmount: '11.00' });
    if (mode === 'quantity') state().editLineText(scope, id(1), 'p', 'quantity', '0');
    if (mode === 'payment') {
      state().clearDraft(scope, id(1));
      state().startDraft(scope, id(1));
      state().addLine(
        scope,
        id(1),
        { lineId: 'p', itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
        scope.businessId,
      );
    }
    if (mode === 'empty') state().removeLine(scope, id(1), 'p');
    await setup();
    await screen.findByText('Cliente: Sin cliente');
    await waitFor(() =>
      expect(screen.queryByText('Consultando referencias o stock del resumen…')).toBeNull(),
    );
    expect(submit()).toBeDisabled();
    await fireEvent.press(submit());
    expect(mockRpc).not.toHaveBeenCalled();
  },
);

test('foreign-client/backend denial stays safe and does not retry as a no-client sale', async () => {
  direct(id(60));
  jest.mocked(useLocalSearchParams).mockReturnValue({ clientId: id(60) });
  mockRpc.mockResolvedValue({
    data: null,
    error: { code: '22023', message: 'private foreign-client detail' },
    status: 400,
  });
  await setup();
  await ready();
  await fireEvent.press(submit());
  await screen.findByText(checkoutError('INVALID_INPUT').message);
  expect(screen.queryByText('private foreign-client detail')).toBeNull();
  expect(state().draft?.clientId).toBe(id(60));
  expect(router.replace).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc.mock.calls[0][1].p_client_id).toBe(id(60));
});

test('BARBER cannot use a no-client draft to reach the write boundary', async () => {
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  await setup();
  expect(screen.queryByRole('button', { name: 'Completar venta' })).toBeNull();
  expect(mockRpc).not.toHaveBeenCalled();
});

test.each(['user', 'business', 'membership', 'logout'])(
  'pending no-client sale cannot navigate or clear a new intention after %s change',
  async (mode) => {
    let resolve!: (value: ReturnType<typeof envelope>) => void;
    mockRpc.mockReturnValue(
      new Promise<ReturnType<typeof envelope>>((done) => {
        resolve = done;
      }),
    );
    const { rerender } = await setup();
    await ready();
    await fireEvent.press(submit());
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(state().submission?.capture.input.clientId).toBeNull();
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
      resolve(envelope());
    });
    expect(state().draft).toBe(replacement);
    expect(router.replace).not.toHaveBeenCalled();
  },
);
