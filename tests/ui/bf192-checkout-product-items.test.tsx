import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { productsKeys } from '@/features/products/constants/productsKeys';
import { productsService } from '@/features/products/services/productsService';
import type { ProductRow } from '@/features/products/types/product.types';
import { CheckoutProductItems } from '@/features/sales/components/CheckoutProductItems';
import { checkoutDraftStore } from '@/features/sales/store/checkoutDraftStore';
import { addCheckoutProduct } from '@/features/sales/utils/checkoutProductItems';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { listByBusiness: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK or write');
});
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  uuid: { v4: jest.fn() },
}));
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const catalog = jest.mocked(productsService),
  inventory = jest.mocked(inventoryService);
const state = () => checkoutDraftStore.getState();
const row = (patch: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p',
  business_id: 'b',
  name: 'Shampoo',
  category_id: null,
  description: null,
  sku: null,
  sale_price: 10,
  default_purchase_cost: 5,
  minimum_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
  ...patch,
});
let current: ProductRow, balance: string;
function context(userId = 'u', businessId = 'b', membershipId = 'm') {
  jest.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { id: userId },
    session: {},
    error: null,
  } as ReturnType<typeof useAuth>);
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role: 'OWNER',
      business: {
        id: businessId,
        name: 'Demo',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  current = row();
  balance = '5';
  let sequence = 0;
  jest.mocked(uuid.v4).mockImplementation(() => `product-line-${++sequence}`);
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
  catalog.listByBusiness.mockImplementation(async () => ({
    data: { items: [current], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  }));
  catalog.getById.mockImplementation(async () => ({ data: current, error: null }));
  inventory.getProductStock.mockImplementation(async (_business, ids) => ({
    data: ids.map((product_id) => ({ product_id, current_stock: balance })),
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
async function setup() {
  const eligibility = jest.fn();
  const view = await renderWithProviders(
    <CheckoutProductItems onEligibilityChange={eligibility} />,
  );
  await screen.findByRole('button', { name: 'Agregar producto: Shampoo' });
  return { ...view, eligibility };
}
async function add() {
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  await screen.findByText('Productos listos para revisión');
}
test('duplicate PRODUCT rows have unique identity and independent quantities/overrides/remove', async () => {
  await setup();
  await add();
  await add();
  expect(state().draft?.items.map((x) => x.lineId)).toEqual(['product-line-1', 'product-line-2']);
  expect(catalog.getById).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(screen.getByLabelText('Cantidad de producto de línea 1'), '2');
  await fireEvent.changeText(
    screen.getByLabelText('Precio unitario opcional de producto de línea 1'),
    '8.25',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Precio unitario opcional de producto de línea 2'),
    '9.00',
  );
  expect(state().draft?.items.map((x) => [x.quantity, x.unitPriceOverride])).toEqual([
    [2, '8.25'],
    [1, '9.00'],
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Quitar producto de línea 1' }));
  expect(state().draft?.items[0].lineId).toBe('product-line-2');
});
test('aggregate demand across duplicate rows blocks when insufficient without merging/clamping', async () => {
  const { eligibility } = await setup();
  await add();
  await add();
  await fireEvent.changeText(screen.getByLabelText('Cantidad de producto de línea 1'), '2');
  await fireEvent.changeText(screen.getByLabelText('Cantidad de producto de línea 2'), '3');
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: true });
  await fireEvent.changeText(screen.getByLabelText('Cantidad de producto de línea 2'), '4');
  expect(screen.getAllByText('Stock insuficiente para la demanda total.')).toHaveLength(2);
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  expect(state().draft?.items.map((x) => x.quantity)).toEqual([2, 4]);
});
test.each(['0', '-1', '1.5', '2147483648', '', 'abc'])(
  'invalid quantity %s stays visible and invalidates eligibility',
  async (text) => {
    const { eligibility } = await setup();
    await add();
    await fireEvent.changeText(screen.getByLabelText('Cantidad de producto de línea 1'), text);
    expect(screen.getByLabelText('Cantidad de producto de línea 1')).toHaveDisplayValue(text);
    expect(state().draft?.items[0].quantity).toBe(1);
    expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  },
);
test.each(['archived', 'foreign', 'missing'])(
  '%s product remains removable and ineligible',
  async (mode) => {
    const { queryClient, eligibility } = await setup();
    await add();
    if (mode === 'archived') current = row({ is_active: false });
    if (mode === 'foreign') current = row({ business_id: 'other' });
    if (mode === 'missing')
      catalog.getById.mockResolvedValue({
        data: null,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'No disponible' },
      });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: productsKeys.byBusiness('b') });
    });
    await waitFor(() =>
      expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false }),
    );
    expect(state().draft?.items).toHaveLength(1);
    expect(screen.queryByText(/Estimación de producto de línea/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar producto de línea 1' }));
    expect(state().draft?.items).toHaveLength(0);
  },
);
test('real zero stock is reported, not confused with absent stock', async () => {
  balance = '0';
  const { eligibility } = await setup();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  await screen.findByText('Stock disponible: 0 · Demanda total del producto: 1');
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
});
test('loading, read failure and missing stock never manufacture zero', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof inventoryService.getProductStock>>) => void;
  inventory.getProductStock.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { queryClient, eligibility } = await setup();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
  await screen.findByText('Consultando stock…');
  expect(screen.queryByText(/Stock disponible: 0/)).toBeNull();
  await act(async () => {
    resolve({ data: null, error: { code: 'NETWORK_ERROR', message: 'Error seguro' } });
  });
  await screen.findByText('No se pudo consultar el stock.');
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  inventory.getProductStock.mockResolvedValue({ data: [], error: null });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: inventoryKeys.byBusiness('b') });
  });
  await screen.findByText('Stock no disponible; no se asume cero.');
  expect(state().draft?.items).toHaveLength(1);
});
test('catalog price updates estimates while preserving explicit override', async () => {
  const { queryClient } = await setup();
  await add();
  current = row({ sale_price: 12 });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: productsKeys.byBusiness('b') });
  });
  await screen.findByText(/Precio de catálogo actualizado/);
  expect(screen.getByText(/Estimación de producto de línea 1: ARS.*12,00/)).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('Precio unitario opcional de producto de línea 1'),
    '8.25',
  );
  current = row({ sale_price: 15 });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: productsKeys.byBusiness('b') });
  });
  expect(state().draft?.items[0].unitPriceOverride).toBe('8.25');
  expect(screen.getByText(/Estimación de producto de línea 1: ARS.*8,25/)).toBeTruthy();
});
test('pending locks edits and preserves immutable capture', async () => {
  await setup();
  await add();
  await act(() => {
    state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
    state().captureIntent(scope, 'op');
  });
  expect(screen.getByRole('button', { name: 'Agregar producto: Shampoo' })).toBeDisabled();
  expect(screen.getByLabelText('Cantidad de producto de línea 1')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Quitar producto de línea 1' })).toBeDisabled();
});
test.each(['user', 'business', 'membership', 'logout'])(
  '%s context change hides previous items and rejects stale Add',
  async (change) => {
    const { rerender } = await setup();
    await add();
    const old = () => addCheckoutProduct(scope, 'op', 'late', current);
    const next = {
      ...scope,
      [change === 'user' ? 'userId' : change === 'business' ? 'businessId' : 'membershipId']: 'new',
    };
    context(next.userId, next.businessId, next.membershipId);
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await act(() => {
      state().setScope(change === 'logout' ? null : next);
      if (change !== 'logout') state().startDraft(next, 'new-op');
    });
    await rerender(<CheckoutProductItems />);
    expect(old()).toBe(false);
    expect(screen.queryByLabelText('Cantidad de producto de línea 1')).toBeNull();
    expect(state().draft?.items ?? []).toHaveLength(0);
  },
);
