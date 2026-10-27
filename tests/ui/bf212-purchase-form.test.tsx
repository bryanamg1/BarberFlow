import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { purchasesService } from '@/features/purchases/services/purchasesService';
import { productsService } from '@/features/products/services/productsService';
import { expenseCategoriesService } from '@/features/expenses/services/expenseCategoriesService';
import { PurchaseDraftLifecycle } from '@/features/purchases/store/PurchaseDraftLifecycle';
import { purchaseDraftStore } from '@/features/purchases/store/purchaseDraftStore';
import { completePurchaseError } from '@/features/purchases/services/completePurchaseErrors';
import NewRoute from '@/app/(app)/purchases/new';
import { renderWithProviders } from '@/test/renderWithProviders';
import { routerMock } from '@/test/routerTestUtils';
import { agendaContext } from './helpers/agendaFixture';
import { id, businessId, payload, saved } from './helpers/purchaseFixtures';
import type { ProductRow } from '@/features/products/types/product.types';
import type { ExpenseCategoryRow } from '@/features/expenses/repositories/expenseCategoriesRepository';
jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  router: jest.requireActual('@/test/routerTestUtils').routerMock,
  useIsFocused: jest.fn(),
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  uuid: { v4: jest.fn() },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/purchases/services/purchasesService', () => ({
  purchasesService: { completePurchase: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { listByBusiness: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/expenses/services/expenseCategoriesService', () => ({
  expenseCategoriesService: { listByBusiness: jest.fn(), getById: jest.fn() },
}));
const service = jest.mocked(purchasesService),
  products = jest.mocked(productsService),
  cats = jest.mocked(expenseCategoriesService);
const product: ProductRow = {
  id: id(3),
  business_id: businessId,
  name: 'Cera',
  description: null,
  sku: null,
  category_id: null,
  sale_price: 10,
  default_purchase_cost: 5,
  minimum_stock: 0,
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const category: ExpenseCategoryRow = {
  id: id(2),
  business_id: businessId,
  name: 'Mercadería',
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
function Tree({ show = true }: { show?: boolean }) {
  return (
    <>
      <PurchaseDraftLifecycle />
      {show && <NewRoute />}
    </>
  );
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  purchaseDraftStore.getState().setBusiness(null);
  agendaContext({ businessId });
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(uuid.v4).mockReturnValue(id(1));
  products.listByBusiness.mockImplementation(async (_b, p) => ({
    data: { items: [product], page: p?.page ?? 1, pageSize: 25, hasNextPage: (p?.page ?? 1) === 1 },
    error: null,
  }));
  products.getById.mockResolvedValue({ data: product, error: null });
  cats.listByBusiness.mockImplementation(async (_b, p) => ({
    data: {
      items: [category],
      page: p?.page ?? 1,
      pageSize: 25,
      hasNextPage: (p?.page ?? 1) === 1,
    },
    error: null,
  }));
  cats.getById.mockResolvedValue({ data: category, error: null });
  service.completePurchase.mockResolvedValue({ data: saved(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  purchaseDraftStore.getState().setBusiness(null);
});
async function fill() {
  await fireEvent.changeText(
    await screen.findByLabelText('Proveedor (obligatorio)'),
    '  Proveedor  ',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Fecha y hora de compra (ISO con zona)'),
    '2026-01-01T00:00:00Z',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Método: Efectivo' }));
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Categoría de gasto: Mercadería' }),
  );
  await waitFor(() =>
    expect(screen.getAllByText('Categoría de gasto: Mercadería')).toHaveLength(2),
  );
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar producto: Cera' }));
  await screen.findByText('Cera');
  await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 1'), '1.00');
}
test('BF212 initial fields blank, stable operation and empty collection, no date/supplier/method/category/cost defaults', async () => {
  await renderWithProviders(<Tree />);
  await screen.findByLabelText('Proveedor (obligatorio)');
  expect(screen.getByLabelText('Proveedor (obligatorio)').props.value).toBe('');
  expect(screen.getByLabelText('Fecha y hora de compra (ISO con zona)').props.value).toBe('');
  expect(purchaseDraftStore.getState().draft).toEqual({ operationId: id(1), items: [] });
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  expect(service.completePurchase).not.toHaveBeenCalled();
  await screen.findByText(/Ingresa el proveedor\./);
});
test('BF212 exact create, canonical purchase only, persisted detail replace and scoped invalidation', async () => {
  const ui = await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Notas'), '  nota original  ');
  const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/purchases/[id]',
      params: { id: saved().purchase.id },
    }),
  );
  expect(service.completePurchase).toHaveBeenCalledWith(businessId, {
    ...payload(),
    supplierName: '  Proveedor  ',
    notes: '  nota original  ',
  });
  expect(purchaseDraftStore.getState().draft).toBeNull();
  expect(service.completePurchase).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(4));
  for (const prefix of ['inventory', 'purchases', 'products', 'expenses'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [prefix, businessId] });
});
test('BF212 duplicate product lines stay distinct; different costs reject and do not average', async () => {
  const ui = await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Cera' }));
  expect(screen.getByLabelText('Cantidad de línea 2').props.value).toBe('1');
  expect(screen.getByLabelText('Costo unitario de línea 2').props.value).toBe('');
  expect(
    ui.queryClient
      .getQueryCache()
      .findAll({ queryKey: ['products', businessId] })
      .filter((query) => query.queryKey.includes('detail')),
  ).toHaveLength(1);
  await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 2'), '2.00');
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await screen.findByText(/Usa el mismo costo/);
  expect(service.completePurchase).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Costo unitario de línea 1').props.value).toBe('1.00');
  await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 2'), '1.00');
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await waitFor(() => expect(service.completePurchase).toHaveBeenCalledTimes(1));
  expect(service.completePurchase.mock.calls[0][1].items).toHaveLength(2);
});
test('BF212 removal affects only selected line and stable remaining input', async () => {
  await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar producto: Cera' }));
  await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 2'), '3.00');
  await fireEvent.press(screen.getByRole('button', { name: 'Quitar línea 1' }));
  expect(screen.getByLabelText('Costo unitario de línea 1').props.value).toBe('3.00');
  await fireEvent.press(screen.getByRole('button', { name: 'Quitar línea 1' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await screen.findByText('Agrega al menos un producto.');
  expect(service.completePurchase).not.toHaveBeenCalled();
});
test.each(['0', '1.5', '2147483648', ''])(
  'BF212 invalid quantity %s never completes',
  async (text) => {
    await renderWithProviders(<Tree />);
    await fill();
    await fireEvent.changeText(screen.getByLabelText('Cantidad de línea 1'), text);
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(service.completePurchase).not.toHaveBeenCalled();
  },
);
test.each(['', '-1.00', '1.001', '1,00', '10000000000.00'])(
  'BF212 invalid cost %s never completes or rounds',
  async (text) => {
    await renderWithProviders(<Tree />);
    await fill();
    await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 1'), text);
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(service.completePurchase).not.toHaveBeenCalled();
  },
);
test('BF212 civil/zoneless purchase date invalid; explicit offset preserved', async () => {
  await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.changeText(
    screen.getByLabelText('Fecha y hora de compra (ISO con zona)'),
    '2026-01-01',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  expect(service.completePurchase).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByLabelText('Fecha y hora de compra (ISO con zona)'),
    '2026-01-01T12:30:00.123456-03:00',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await waitFor(() => expect(service.completePurchase).toHaveBeenCalledTimes(1));
  expect(service.completePurchase.mock.calls[0][1].purchasedAt).toBe(
    '2026-01-01T12:30:00.123456-03:00',
  );
});
test.each(['inactive', 'foreign', 'missing'] as const)(
  'BF212 selected product becomes %s, stays removable and blocks submit',
  async (state) => {
    const ui = await renderWithProviders(<Tree />);
    await fill();
    products.getById.mockResolvedValue(
      state === 'missing'
        ? { data: null, error: { code: 'PRODUCT_NOT_FOUND', message: 'safe' } }
        : {
            data: {
              ...product,
              is_active: state !== 'inactive',
              business_id: state === 'foreign' ? 'foreign' : businessId,
            },
            error: null,
          },
    );
    await act(() => ui.queryClient.invalidateQueries({ queryKey: ['products', businessId] }));
    await screen.findByText('Producto no disponible');
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(service.completePurchase).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Costo unitario de línea 1').props.value).toBe('1.00');
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar línea 1' }));
  },
);
test.each(['inactive', 'foreign'])(
  'BF212 selected expense category %s cannot be submitted',
  async (state) => {
    const ui = await renderWithProviders(<Tree />);
    await fill();
    cats.getById.mockResolvedValue({
      data: {
        ...category,
        is_active: state !== 'inactive',
        business_id: state === 'foreign' ? 'foreign' : businessId,
      },
      error: null,
    });
    await act(() =>
      ui.queryClient.invalidateQueries({ queryKey: ['expenseCategories', businessId] }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
    await screen.findByText(/Revisa los productos y selecciona/);
    expect(service.completePurchase).not.toHaveBeenCalled();
  },
);
test('BF212 zero cost, exact estimate, no receipt controls or manual expense write', async () => {
  await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Cantidad de línea 1'), '3');
  await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 1'), '0.29');
  await screen.findByText(/Total estimado:.*0,87/);
  await fireEvent.changeText(screen.getByLabelText('Costo unitario de línea 1'), '0.00');
  await screen.findByText(/Total estimado:.*0,00/);
  expect(screen.queryByRole('button', { name: /comprobante|Subir|Adjuntar/ })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await waitFor(() => expect(service.completePurchase).toHaveBeenCalledTimes(1));
  expect(service.completePurchase.mock.calls[0][1].items[0].unitCost).toBe('0.00');
});
test('BF212 explicit cancel clears draft, simple route back preserves it', async () => {
  const ui = await renderWithProviders(<Tree />);
  await fill();
  const before = purchaseDraftStore.getState().draft;
  await ui.rerender(<Tree show={false} />);
  expect(purchaseDraftStore.getState().draft).toEqual(before);
  await ui.rerender(<Tree />);
  expect(screen.getByLabelText('Proveedor (obligatorio)').props.value).toBe('  Proveedor  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar compra' }));
  expect(purchaseDraftStore.getState().draft).toBeNull();
  expect(routerMock.replace).toHaveBeenCalledWith('/purchases');
});
test('BF212 pending blocks double submit/edit/cancel; confirmed refresh failure remains success', async () => {
  let finish!: (v: Awaited<ReturnType<typeof purchasesService.completePurchase>>) => void;
  service.completePurchase.mockReturnValue(
    new Promise((r) => {
      finish = r;
    }),
  );
  const ui = await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await screen.findByText('Registrando compra…');
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar compra' }));
  await fireEvent.changeText(screen.getByLabelText('Proveedor (obligatorio)'), 'late');
  expect(screen.getByLabelText('Proveedor (obligatorio)').props.value).toBe('  Proveedor  ');
  jest.spyOn(ui.queryClient, 'invalidateQueries').mockRejectedValue(Error('private refresh'));
  await act(() => finish({ data: saved(), error: null }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/purchases/[id]',
      params: { id: saved().purchase.id },
    }),
  );
  expect(service.completePurchase).toHaveBeenCalledTimes(1);
});
test.each(['NETWORK_ERROR', 'UNKNOWN_ERROR', 'CONFLICT'] as const)(
  'BF212 %s immutable retry and route remount preserve exact operation',
  async (code) => {
    service.completePurchase.mockResolvedValueOnce({
      data: null,
      error: completePurchaseError(code),
    });
    const ui = await renderWithProviders(<Tree />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
    await screen.findByRole('button', { name: 'Reintentar compra original' });
    const first = service.completePurchase.mock.calls[0][1];
    await ui.rerender(<Tree show={false} />);
    await ui.rerender(<Tree />);
    await fireEvent.changeText(screen.getByLabelText('Proveedor (obligatorio)'), 'late');
    expect(screen.getByLabelText('Proveedor (obligatorio)').props.value).toBe(first.supplierName);
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar compra original' }));
    await waitFor(() => expect(service.completePurchase).toHaveBeenCalledTimes(2));
    expect(service.completePurchase.mock.calls[1][1]).toEqual(first);
  },
);
test('BF212 definitive rejection preserves fields; explicit editing starts new key', async () => {
  service.completePurchase.mockResolvedValueOnce({
    data: null,
    error: completePurchaseError('INVALID_INPUT'),
  });
  await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await screen.findByRole('button', { name: 'Editar con nueva intención' });
  jest.mocked(uuid.v4).mockReturnValue(id(20));
  await fireEvent.press(screen.getByRole('button', { name: 'Editar con nueva intención' }));
  expect(screen.getByLabelText('Proveedor (obligatorio)').props.value).toBe('  Proveedor  ');
  await fireEvent.changeText(screen.getByLabelText('Proveedor (obligatorio)'), 'Nuevo');
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await waitFor(() => expect(service.completePurchase).toHaveBeenCalledTimes(2));
  expect(service.completePurchase.mock.calls[1][1].operationId).toBe(id(20));
});
test.each(['user', 'business', 'membership', 'role', 'logout'])(
  'BF212 late result after %s switch cannot clear new draft, invalidate or navigate',
  async (change) => {
    let finish!: (v: Awaited<ReturnType<typeof purchasesService.completePurchase>>) => void;
    service.completePurchase.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const ui = await renderWithProviders(<Tree />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
    await screen.findByText('Registrando compra…');
    const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
    if (change === 'user') agendaContext({ businessId, userId: 'new' });
    if (change === 'business') agendaContext({ businessId: 'new' });
    if (change === 'membership') agendaContext({ businessId, membershipId: 'new' });
    if (change === 'role') agendaContext({ businessId, role: 'BARBER' });
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await ui.rerender(<Tree />);
    await act(() => finish({ data: saved(), error: null }));
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(service.completePurchase).toHaveBeenCalledTimes(1);
  },
);
test('BF212 BARBER direct route is blocked and no catalog/write requested', async () => {
  agendaContext({ businessId, role: 'BARBER' });
  await renderWithProviders(<Tree />);
  await screen.findByText('Acceso restringido');
  expect(products.listByBusiness).not.toHaveBeenCalled();
  expect(service.completePurchase).not.toHaveBeenCalled();
});

test('BF212 leaving a pending request preserves ambiguous capture and only explicit same-key retry writes again', async () => {
  let finish!: (v: Awaited<ReturnType<typeof purchasesService.completePurchase>>) => void;
  service.completePurchase.mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const ui = await renderWithProviders(<Tree />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Registrar compra' }));
  await screen.findByText('Registrando compra…');
  const first = service.completePurchase.mock.calls[0][1];
  await ui.rerender(<Tree show={false} />);
  await ui.rerender(<Tree />);
  await screen.findByRole('button', { name: 'Reintentar compra original' });
  expect(service.completePurchase).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar compra original' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  expect(service.completePurchase.mock.calls[1][1]).toEqual(first);
  await act(() => finish({ data: saved(), error: null }));
  expect(routerMock.replace).toHaveBeenCalledTimes(1);
});

test('BF212 paginated catalogs use actual parameters and empty/error are distinct, no fabricated refs', async () => {
  const ui = await renderWithProviders(<Tree />);
  await screen.findByRole('button', { name: 'Agregar producto: Cera' });
  await fireEvent.press(screen.getByRole('button', { name: 'Más productos' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Más categorías de gastos' }));
  await waitFor(() =>
    expect(products.listByBusiness).toHaveBeenCalledWith(businessId, {
      page: 2,
      pageSize: 25,
      status: 'active',
    }),
  );
  await waitFor(() =>
    expect(cats.listByBusiness).toHaveBeenCalledWith(businessId, {
      page: 2,
      pageSize: 25,
      status: 'active',
    }),
  );
  products.listByBusiness.mockResolvedValue({
    data: { items: [], page: 2, pageSize: 25, hasNextPage: false },
    error: null,
  });
  await act(() => ui.queryClient.invalidateQueries({ queryKey: ['products', businessId] }));
  await screen.findByText('No hay productos activos en esta página.');
  products.listByBusiness.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No se pudieron cargar los productos.' },
  });
  await act(() => ui.queryClient.invalidateQueries({ queryKey: ['products', businessId] }));
  await screen.findByText('No se pudieron cargar los productos.');
  expect(screen.queryByText('No hay productos activos en esta página.')).toBeNull();
  expect(service.completePurchase).not.toHaveBeenCalled();
});
