import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { useLocalSearchParams } from 'expo-router';

import NewSaleRoute from '@/app/(app)/sales/new';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { productsService } from '@/features/products/services/productsService';
import { servicesService } from '@/features/services/services/servicesService';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { CheckoutDraftLifecycle } from '@/features/sales/store/CheckoutDraftLifecycle';
import { checkoutService } from '@/features/sales/services/checkoutService';
import { checkoutError } from '@/features/sales/services/checkoutErrors';
import type { CompleteCheckoutResult } from '@/features/sales/types/checkout.types';
import { formatMoney } from '@/utils/formatMoney';
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

const quantity = (line = 1) => screen.getByLabelText(`Cantidad de producto de línea ${line}`);
const quantityError = 'Error: Ingresa una cantidad entera entre 1 y 2147483647.';
const subtotal = (value: string) => `Subtotal estimado: ${formatMoney(value, 'ARS')}`;

test('direct quantity starts at1, selects text on focus and valid integer updates existing summary/pipeline', async () => {
  await setup();
  await ready();
  expect(quantity().props.value).toBe('1');
  expect(quantity().props.selectTextOnFocus).toBe(true);
  expect(quantity().props.accessibilityHint).toContain('esta línea');
  await fireEvent.changeText(quantity(), '3');
  expect(state().draft?.items.find((line) => line.itemType === 'PRODUCT')?.quantity).toBe(3);
  expect(screen.getByText(subtotal('130.00'))).toBeTruthy();
  expect(submit()).toBeEnabled();
});
test('duplicate quantities target lineId, aggregate demand changes and explicit remove affects one line only', async () => {
  jest
    .mocked(inventoryService.getProductStock)
    .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '6' }], error: null });
  await setup();
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  await screen.findByLabelText('Cantidad de producto de línea 2');
  await fireEvent.changeText(quantity(1), '2');
  await fireEvent.changeText(quantity(2), '4');
  expect(
    state()
      .draft?.items.filter((line) => line.itemType === 'PRODUCT')
      .map((line) => [line.lineId, line.quantity]),
  ).toEqual([
    ['local-product', 2],
    [id(90), 4],
  ]);
  expect(screen.getAllByText('Stock disponible: 6 · Demanda total del producto: 6')).toHaveLength(
    2,
  );
  expect(submit()).toBeEnabled();
  await fireEvent.changeText(quantity(1), '3');
  expect(quantity(2).props.value).toBe('4');
  expect(screen.getAllByText('Stock disponible: 6 · Demanda total del producto: 7')).toHaveLength(
    2,
  );
  expect(submit()).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Quitar producto de línea 1' }));
  expect(
    state()
      .draft?.items.filter((line) => line.itemType === 'PRODUCT')
      .map((line) => [line.lineId, line.quantity]),
  ).toEqual([[id(90), 4]]);
  expect(screen.getByText('Stock disponible: 6 · Demanda total del producto: 4')).toBeTruthy();
  expect(screen.getByText(subtotal('140.00'))).toBeTruthy();
  expect(submit()).toBeEnabled();
});
test.each(['0', '-1', '1.5', '', 'malformed', '2147483648', '9007199254740993'])(
  'invalid raw quantity "%s" stays visible, cannot use stale valid value or remove line, correction restores eligibility',
  async (text) => {
    await setup();
    await ready();
    await fireEvent.changeText(quantity(), text);
    expect(quantity().props.value).toBe(text);
    expect(screen.getByText(quantityError)).toBeTruthy();
    expect(submit()).toBeDisabled();
    expect(screen.queryByText(/Demanda total del producto:/)).toBeNull();
    expect(state().draft?.items.filter((line) => line.itemType === 'PRODUCT')).toHaveLength(1);
    expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
    expect(screen.queryByText(subtotal('110.00'))).toBeNull();
    expect(state().captureIntent(scope, id(1))).toBeNull();
    expect(service).not.toHaveBeenCalled();
    await fireEvent.changeText(quantity(), '2');
    expect(quantity().props.value).toBe('2');
    expect(screen.queryByText(quantityError)).toBeNull();
    expect(screen.getByText(subtotal('120.00'))).toBeTruthy();
    expect(submit()).toBeEnabled();
  },
);
test('approved int32 maximum is preserved without a new limit or silent clamp', async () => {
  await setup();
  await ready();
  await fireEvent.changeText(quantity(), '2147483647');
  expect(quantity().props.value).toBe('2147483647');
  expect(screen.queryByText(quantityError)).toBeNull();
  expect(state().draft?.items.find((line) => line.itemType === 'PRODUCT')?.quantity).toBe(
    2147483647,
  );
  expect(submit()).toBeDisabled();
});
test('zero stock is real zero, no removal or stock mutation', async () => {
  jest
    .mocked(inventoryService.getProductStock)
    .mockResolvedValue({ data: [{ product_id: id(3), current_stock: '0' }], error: null });
  await setup();
  await screen.findByText('Stock disponible: 0 · Demanda total del producto: 1');
  await fireEvent.changeText(quantity(), '2');
  expect(screen.getByText('Stock disponible: 0 · Demanda total del producto: 2')).toBeTruthy();
  expect(submit()).toBeDisabled();
  expect(service).not.toHaveBeenCalled();
});
test.each(['pending', 'error'] as const)(
  'stock %s cannot become a zero balance after valid quantity edit',
  async (mode) => {
    if (mode === 'pending')
      jest.mocked(inventoryService.getProductStock).mockReturnValue(new Promise(() => {}));
    else
      jest.mocked(inventoryService.getProductStock).mockResolvedValue({
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'No disponible' },
      });
    await setup();
    await screen.findByText(
      mode === 'pending' ? 'Consultando stock…' : 'No se pudo consultar el stock.',
    );
    await fireEvent.changeText(quantity(), '2');
    expect(quantity().props.value).toBe('2');
    expect(submit()).toBeDisabled();
    expect(screen.queryByText(/Stock disponible: 0/)).toBeNull();
  },
);
test('pending capture locks quantity and remove; raw callbacks cannot mutate captured quantity', async () => {
  const pending = deferred();
  service.mockReturnValue(pending.promise);
  await setup();
  await ready();
  await fireEvent.changeText(quantity(), '3');
  await fireEvent.press(submit());
  const capture = state().submission!.capture;
  expect(quantity()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Quitar producto de línea 1' })).toBeDisabled();
  await fireEvent.changeText(quantity(), '5');
  expect(quantity().props.value).toBe('3');
  expect(capture.input.items.find((line) => line.itemType === 'PRODUCT')?.quantity).toBe(3);
  await act(() => {
    pending.resolve({ data: null, error: checkoutError('INSUFFICIENT_STOCK') });
  });
  await screen.findByText(checkoutError('INSUFFICIENT_STOCK').message);
});
test('uncertain retry retains the exact captured quantity/key; no recapture or input edits', async () => {
  const result = saved();
  result.items[1].quantity = 3;
  result.items[1].line_total = 30;
  result.sale.subtotal = result.sale.total = result.payments[0].amount = 130;
  service
    .mockResolvedValueOnce({ data: null, error: checkoutError('NETWORK_ERROR') })
    .mockResolvedValueOnce({ data: result, error: null });
  await setup();
  await ready();
  await fireEvent.changeText(quantity(), '3');
  await fireEvent.press(submit());
  await screen.findByRole('button', { name: 'Reintentar intención original' });
  const capture = state().submission!.capture;
  expect(quantity()).toBeDisabled();
  await fireEvent.changeText(quantity(), '8');
  expect(quantity().props.value).toBe('3');
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar intención original' }));
  await screen.findByText('Venta confirmada');
  expect(service.mock.calls[1][1]).toBe(capture.input);
  expect(service.mock.calls[1][1].operationId).toBe(id(1));
  expect(capture.input.items.find((line) => line.itemType === 'PRODUCT')?.quantity).toBe(3);
});
test.each(['user', 'business', 'membership', 'logout'])(
  '%s change clears quantity text and stale editor callback cannot alter another intention',
  async (mode) => {
    const { rerender } = await setup();
    await ready();
    await fireEvent.changeText(quantity(), 'invalid');
    const edit = quantity().props.onChangeText as (value: string) => void;
    if (mode === 'user') context(id(50));
    if (mode === 'business') context(scope.userId, id(50));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(50));
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await rerender(<App />);
    await act(() => {
      edit('4');
    });
    expect(state().lineEdits).toEqual({});
    expect(state().draft?.operationId).not.toBe(id(1));
    expect(service).not.toHaveBeenCalled();
  },
);
