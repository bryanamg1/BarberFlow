import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { useAuth } from '@/features/auth/context/AuthContext';
import { productsService } from '@/features/products/services/productsService';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { productsKeys } from '@/features/products/constants/productsKeys';
import type { ProductRow } from '@/features/products/types/product.types';
import type { ProductResult, ProductListPage } from '@/features/products/types/productHooks.types';
import { CheckoutProductItems } from '@/features/sales/components/CheckoutProductItems';
import { DirectSaleProductSelector } from '@/features/sales/components/DirectSaleProductSelector';
import { CheckoutDraftLifecycle } from '@/features/sales/store/CheckoutDraftLifecycle';
import { addCheckoutProduct } from '@/features/sales/utils/checkoutProductItems';
import { renderWithProviders } from '@/test/renderWithProviders';
import { context, scope, state, id, productRow } from './helpers/checkoutFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  uuid: { v4: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { listByBusiness: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No inventory write or SDK');
});
let rows: ProductRow[], current: ProductRow, balance: string;
const page = (items = rows): ProductListPage => ({
  items,
  page: 1,
  pageSize: 25,
  hasNextPage: false,
});
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, id(1));
  current = { ...productRow };
  rows = [current];
  balance = '5';
  let sequence = 90;
  jest.mocked(uuid.v4).mockImplementation(() => id(sequence++));
  jest
    .mocked(productsService.listByBusiness)
    .mockImplementation(async () => ({ data: page(), error: null }));
  jest
    .mocked(productsService.getById)
    .mockImplementation(async () => ({ data: current, error: null }));
  jest.mocked(inventoryService.getProductStock).mockImplementation(async (_business, ids) => ({
    data: ids.map((product_id) => ({ product_id, current_stock: balance })),
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
function App() {
  return (
    <>
      <CheckoutDraftLifecycle />
      <CheckoutProductItems selector={<DirectSaleProductSelector />} />
    </>
  );
}
const setup = () => renderWithProviders(<App />);
const add = () =>
  fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Shampoo' }));
function deferred() {
  let resolve!: (v: ProductResult<ProductListPage>) => void;
  const promise = new Promise<ProductResult<ProductListPage>>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test('direct selector uses real active paged reader and BF175 batch badge without another picker', async () => {
  await setup();
  await screen.findByRole('heading', { name: 'Seleccionar productos' });
  await screen.findByText('Stock: 5 · Normal');
  expect(screen.getAllByRole('button', { name: 'Agregar producto: Shampoo' })).toHaveLength(1);
  expect(productsService.listByBusiness).toHaveBeenCalledWith(scope.businessId, {
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  expect(inventoryService.getProductStock).toHaveBeenCalledWith(scope.businessId, [id(3)]);
  expect(state().draft?.items).toEqual([]);
});
test('loading catalog is not a successful empty list; explicit read failure can be retried', async () => {
  const pending = deferred();
  jest.mocked(productsService.listByBusiness).mockReturnValueOnce(pending.promise);
  await setup();
  expect(screen.getByText('Cargando productos…')).toBeTruthy();
  expect(screen.queryByText('No hay productos activos para seleccionar')).toBeNull();
  await act(() => {
    pending.resolve({
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'Catálogo no disponible.' },
    });
  });
  await screen.findByText('Catálogo no disponible.');
  expect(screen.queryByRole('button', { name: 'Agregar producto: Shampoo' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('button', { name: 'Agregar producto: Shampoo' });
});
test('empty catalog is explicit and makes no stock query', async () => {
  rows = [];
  await setup();
  await screen.findByText('No hay productos activos para seleccionar');
  expect(inventoryService.getProductStock).not.toHaveBeenCalled();
});
test('foreign and archived products are neither offered nor sent to the stock batch; programmatic guard rejects them', async () => {
  const foreign = { ...current, id: id(40), business_id: id(50), name: 'Foreign' },
    archived = { ...current, id: id(41), is_active: false, name: 'Archived' };
  rows = [current, foreign, archived];
  await setup();
  await screen.findByText('Stock: 5 · Normal');
  expect(screen.queryByText('Foreign')).toBeNull();
  expect(screen.queryByText('Archived')).toBeNull();
  expect(addCheckoutProduct(scope, id(1), id(99), foreign)).toBe(false);
  expect(addCheckoutProduct(scope, id(1), id(99), archived)).toBe(false);
  expect(inventoryService.getProductStock).toHaveBeenCalledWith(scope.businessId, [id(3)]);
});
test('repeated selection delegates BF192 with unique lineIds and independent qty1/estimates', async () => {
  await setup();
  await screen.findByText('Stock: 5 · Normal');
  await add();
  await add();
  await screen.findByText('Productos listos para revisión');
  expect(
    state().draft?.items.map((line) => [line.lineId, line.itemType, line.itemId, line.quantity]),
  ).toEqual([
    [id(90), 'PRODUCT', id(3), 1],
    [id(91), 'PRODUCT', id(3), 1],
  ]);
  expect(screen.getAllByText(/Precio de catálogo estimado:/)).toHaveLength(2);
  expect(productsService.getById).toHaveBeenCalledTimes(1);
});
test('search is explicitly page-local; pagination reuses the existing reader and resets visible filter', async () => {
  rows = [current, { ...current, id: id(33), name: 'Cera' }];
  jest.mocked(productsService.listByBusiness).mockImplementation(async (_business, params) => ({
    data: {
      ...page(params?.page === 2 ? [{ ...current, id: id(34), name: 'Peine' }] : rows),
      page: params?.page ?? 1,
      hasNextPage: params?.page !== 2,
    },
    error: null,
  }));
  await setup();
  await screen.findByRole('button', { name: 'Agregar producto: Cera' });
  await fireEvent.changeText(screen.getByLabelText('Buscar en esta página'), 'cErA');
  expect(screen.queryByRole('button', { name: 'Agregar producto: Shampoo' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Buscar en esta página'), 'no match');
  expect(screen.getByText('No hay coincidencias en esta página')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('button', { name: 'Agregar producto: Peine' });
  expect(screen.getByLabelText('Buscar en esta página').props.value).toBe('');
  expect(productsService.listByBusiness).toHaveBeenCalledWith(scope.businessId, {
    page: 2,
    pageSize: 25,
    status: 'active',
  });
});
test('actual zero stock remains selectable as BF192, but selected intent is ineligible without removing it', async () => {
  balance = '0';
  await setup();
  await screen.findByText('Stock: 0 · Sin stock');
  await add();
  await screen.findByText('Stock insuficiente para la demanda total.');
  expect(state().draft?.items).toHaveLength(1);
  expect(screen.queryByText('Productos listos para revisión')).toBeNull();
});
test('pending stock is never shown as zero', async () => {
  jest.mocked(inventoryService.getProductStock).mockReturnValue(new Promise(() => {}));
  await setup();
  await screen.findByText('Cargando stock…');
  expect(screen.queryByText('Stock: 0 · Sin stock')).toBeNull();
});
test('stock error remains distinct from zero and retry is read-only', async () => {
  jest.mocked(inventoryService.getProductStock).mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No disponible' },
  });
  await setup();
  await screen.findByText('Error al cargar stock');
  expect(screen.queryByText('Stock: 0 · Sin stock')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Stock: 5 · Normal');
});
test('archive after selection removes only catalog choice, preserves line and override and blocks eligibility', async () => {
  const { queryClient } = await setup();
  await screen.findByText('Stock: 5 · Normal');
  await add();
  await screen.findByText('Productos listos para revisión');
  await fireEvent.changeText(
    screen.getByLabelText('Precio unitario opcional de producto de línea 1'),
    '8.00',
  );
  current = { ...current, is_active: false };
  await act(() => {
    queryClient.setQueryData(productsKeys.detail(scope, id(3)), current);
    queryClient.setQueryData(
      productsKeys.list(scope, { page: 1, pageSize: 25, status: 'active' }),
      page([current]),
    );
  });
  expect(screen.queryByRole('button', { name: 'Agregar producto: Shampoo' })).toBeNull();
  expect(screen.getByText('No disponible')).toBeTruthy();
  expect(state().draft?.items[0].unitPriceOverride).toBe('8.00');
  expect(state().draft?.items).toHaveLength(1);
  expect(screen.queryByText('Productos listos para revisión')).toBeNull();
});
test.each(['pending', 'uncertain'] as const)(
  '%s capture disables add and pagination without changing captured input',
  async (status) => {
    await setup();
    await screen.findByText('Stock: 5 · Normal');
    await add();
    await screen.findByText('Productos listos para revisión');
    let capture!: NonNullable<ReturnType<typeof state>['submission']>['capture'];
    await act(() => {
      state().patchDraft(scope, id(1), { paymentMethod: 'CASH' });
      capture = state().captureIntent(scope, id(1))!;
      if (status === 'uncertain') state().settleCapture(capture, 'uncertain');
    });
    expect(screen.getByRole('button', { name: 'Agregar producto: Shampoo' })).toBeDisabled();
    expect(screen.getByLabelText('Buscar en esta página')).toBeDisabled();
    await add();
    expect(state().draft?.items).toHaveLength(1);
    expect(state().submission?.capture).toBe(capture);
  },
);
test.each(['user', 'business', 'membership', 'logout'])(
  '%s switch hides stale catalog and cannot reuse the previous intention',
  async (mode) => {
    const pending = deferred();
    jest.mocked(productsService.listByBusiness).mockReturnValueOnce(pending.promise);
    const { rerender } = await setup();
    if (mode === 'user') context(id(50));
    if (mode === 'business') context(scope.userId, id(50));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(50));
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    rows = [];
    await rerender(<App />);
    await act(() => {
      pending.resolve({ data: page([productRow]), error: null });
    });
    expect(screen.queryByRole('button', { name: 'Agregar producto: Shampoo' })).toBeNull();
    expect(state().draft).toBeNull();
    expect(addCheckoutProduct(scope, id(1), id(99), productRow)).toBe(false);
  },
);
test('direct selector is absent for appointment context and BARBER', async () => {
  state().clearDraft(scope, id(1));
  state().startDraft(scope, id(1), { appointmentId: id(9) });
  const { rerender } = await setup();
  expect(screen.queryByRole('heading', { name: 'Seleccionar productos' })).toBeNull();
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  await rerender(<App />);
  expect(screen.queryByRole('heading', { name: 'Seleccionar productos' })).toBeNull();
});
