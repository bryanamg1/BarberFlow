import type { Session } from '@supabase/supabase-js';
import { defaultScheduler, notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { productsService } from '@/features/products/services/productsService';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { productCategoriesService } from '@/features/products/services/productCategoriesService';
import { useProductCategoriesByIds } from '@/features/products/hooks/useProductCategoriesByIds';
import { ProductsScreen } from '@/features/products/screens/ProductsScreen';
import { ProductDetailScreen } from '@/features/products/screens/ProductDetailScreen';
import ProductRoute from '@/app/(app)/products/[id]';
import type { CreateProductInput } from '@/features/products/schemas/product.schema';
import type { ProductRow } from '@/features/products/types/product.types';
import type { ProductListPage } from '@/features/products/types/productHooks.types';
import type { ProductCategoryRow } from '@/features/products/repositories/productCategoriesRepository';
import { productError } from '@/features/products/utils/productErrors';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { cloneElement, type ReactElement } from 'react';
jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: jest.fn(),
  useLocalSearchParams: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: {
    listByBusiness: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: { getByIds: jest.fn(), getById: jest.fn(), listByBusiness: jest.fn() },
}));
const service = jest.mocked(productsService);
const categoryService = jest.mocked(productCategoriesService);
const at = '2026-01-01T00:00:00Z';
const payload = (): CreateProductInput => ({
  name: '  Original  ',
  category_id: 'c',
  sale_price: 10.5,
  default_purchase_cost: 6.5,
  minimum_stock: 0,
  description: null,
  sku: null,
});
const row = (id = 'e', businessId = 'b'): ProductRow => ({
  ...payload(),
  id,
  business_id: businessId,
  name: 'Original',
  category_id: 'c',
  description: null,
  sku: null,
  is_active: true,
  created_at: at,
  updated_at: at,
});
const page = (businessId = 'b'): ProductListPage => ({
  items: [row('e', businessId)],
  page: 1,
  pageSize: 25,
  hasNextPage: false,
});
function context(
  businessId = 'b',
  userId = 'u',
  membershipId = 'm',
  role: 'OWNER' | 'BARBER' = 'OWNER',
) {
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
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role,
      business: {
        id: businessId,
        name: 'Test',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const category = (id = 'c', active = true): ProductCategoryRow => ({
  id,
  business_id: 'b',
  name: id === 'c' ? 'Cabello' : 'Accesorios históricos',
  is_active: active,
  created_at: at,
  updated_at: at,
});
const items = () => [
  row(),
  { ...row('p2'), name: 'Peine', is_active: false, category_id: 'archived-201' },
  { ...row('p3'), name: 'Sin clasificar', category_id: null },
];
async function mountScreen(element: ReactElement) {
  const client = createTestQueryClient();
  const tree = () => (
    <QueryClientProvider client={client}>{cloneElement(element)}</QueryClientProvider>
  );
  const view = await render(tree());
  return { client, rerender: () => view.rerender(tree()), unmount: () => view.unmount() };
}
beforeEach(() => {
  jest.mocked(inventoryService.getProductStock).mockResolvedValue({ data: [], error: null });
  notifyManager.setScheduler(queueMicrotask);
  context();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'e' });
  jest.mocked(router.canGoBack).mockReturnValue(false);
  service.listByBusiness.mockImplementation(async (_b, p) => ({
    data: { items: items(), page: p?.page ?? 1, pageSize: 25, hasNextPage: (p?.page ?? 1) === 1 },
    error: null,
  }));
  service.getById.mockImplementation(async (b, id) => ({ data: row(id, b), error: null }));
  categoryService.getByIds.mockImplementation(async (_b, ids) => ({
    data: ids.map((id) => category(id, id !== 'archived-201')),
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

test.each(['OWNER', 'BARBER'] as const)(
  'BF198A %s has history entry without granting checkout/admin writes',
  async (role) => {
    context('b', 'u', 'm', role);
    await mountScreen(<ProductsScreen />);
    await screen.findByText('Sin clasificar');
    await userEvent.press(screen.getByRole('button', { name: 'Historial de ventas' }));
    expect(router.push).toHaveBeenCalledWith('/sales');
    if (role === 'BARBER') {
      expect(screen.queryByRole('button', { name: 'Nueva venta' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Crear producto' })).toBeNull();
    }
  },
);
test('list populated resolves active/archived page categories once, null excluded, no per-row lookup/IDs/stock/admin', async () => {
  await mountScreen(<ProductsScreen />);
  await screen.findByText('Sin clasificar');
  await screen.findByText('Accesorios históricos (archivada)');
  expect(screen.getByText('Sin categoría')).toBeTruthy();
  expect(screen.getByText('Archivado')).toBeTruthy();
  expect(categoryService.getByIds).toHaveBeenCalledTimes(1);
  expect(categoryService.getByIds).toHaveBeenCalledWith('b', ['archived-201', 'c']);
  expect(categoryService.getById).not.toHaveBeenCalled();
  expect(categoryService.listByBusiness).not.toHaveBeenCalled();
  for (const id of ['e', 'b', 'archived-201']) expect(screen.queryByText(id)).toBeNull();
  expect(screen.queryByText(/Stock actual/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Crear producto' })).toBeTruthy();
});
test('list pending then empty, no batch read without category IDs', async () => {
  const d = deferred<Awaited<ReturnType<typeof productsService.listByBusiness>>>();
  service.listByBusiness.mockReturnValueOnce(d.promise);
  await mountScreen(<ProductsScreen />);
  expect(screen.getByText('Cargando productos…')).toBeTruthy();
  await act(async () => d.resolve({ data: { ...page(), items: [] }, error: null }));
  await screen.findByText('No hay productos para estos filtros.');
  expect(categoryService.getByIds).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});
test('list safe error and accessible retry preserve intended query', async () => {
  service.listByBusiness.mockResolvedValueOnce({
    data: null,
    error: productError('NETWORK_ERROR'),
  });
  await mountScreen(<ProductsScreen />);
  await screen.findByText('No se pudo conectar. Inténtalo nuevamente.');
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Sin clasificar');
  expect(service.listByBusiness).toHaveBeenCalledTimes(2);
});
test('pagination loads next page category set only; status filter resets first page', async () => {
  service.listByBusiness.mockImplementation(async (_b, p) => ({
    data: {
      ...page(),
      items: [{ ...row('p' + p?.page), category_id: p?.page === 2 ? 'next' : 'c' }],
      page: p?.page ?? 1,
      hasNextPage: p?.page === 1,
    },
    error: null,
  }));
  await mountScreen(<ProductsScreen />);
  await screen.findByText('Cabello');
  await userEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
  await waitFor(() => expect(categoryService.getByIds).toHaveBeenLastCalledWith('b', ['next']));
  expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
    page: 2,
    pageSize: 25,
    status: 'active',
    categoryId: undefined,
  });
  await userEvent.press(screen.getByRole('button', { name: 'Archivados' }));
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      status: 'inactive',
      categoryId: undefined,
    }),
  );
});
test('category filter is a server param and can be cleared without new category reads', async () => {
  await mountScreen(<ProductsScreen />);
  await screen.findByText('Cabello');
  await userEvent.press(screen.getByRole('button', { name: 'Filtrar por Cabello' }));
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      status: 'active',
      categoryId: 'c',
    }),
  );
  await userEvent.press(screen.getByRole('button', { name: 'Quitar filtro de categoría' }));
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      status: 'active',
      categoryId: undefined,
    }),
  );
  expect(categoryService.getById).not.toHaveBeenCalled();
});
test('missing category is neutral, category errors preserve product and can retry', async () => {
  categoryService.getByIds.mockResolvedValueOnce({ data: [], error: null });
  const h = await mountScreen(<ProductsScreen />);
  await screen.findAllByText('Categoría no disponible');
  expect(screen.getByText('Peine')).toBeTruthy();
  await h.unmount();
  categoryService.getByIds.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No se pudieron cargar las categorías.' },
  });
  await mountScreen(<ProductsScreen />);
  await screen.findByText('No se pudieron cargar las categorías.');
  expect(screen.getByText('Peine')).toBeTruthy();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Cabello');
});
test('row and category navigation use only actual routes', async () => {
  await mountScreen(<ProductsScreen />);
  await screen.findByText('Peine');
  await userEvent.press(screen.getByRole('button', { name: /^Ver producto Peine, Archivado/ }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/products/[id]', params: { id: 'p2' } });
  await userEvent.press(screen.getByRole('button', { name: 'Categorías' }));
  expect(router.push).toHaveBeenLastCalledWith('/products/categories');
});
for (const role of ['OWNER', 'BARBER'] as const)
  test(role + ' reads list/detail and only OWNER keeps existing adjustment action', async () => {
    context('b', 'u', 'm', role);
    const a = await mountScreen(<ProductsScreen />);
    await screen.findByText('Peine');
    await a.unmount();
    await mountScreen(<ProductDetailScreen productId="e" />);
    await screen.findByText('Categoría: Cabello');
    expect(screen.getByText(/Precio de venta:/)).toBeTruthy();
    expect(screen.getByText('Stock mínimo: 0')).toBeTruthy();
    expect(screen.getByText('SKU: No especificado')).toBeTruthy();
    expect(screen.queryByText(/Stock actual/)).toBeNull();
    if (role === 'OWNER') {
      await userEvent.press(screen.getByRole('button', { name: 'Editar producto' }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: '/products/[id]/edit',
        params: { id: 'e' },
      });
    } else {
      expect(screen.queryByRole('button', { name: 'Editar producto' })).toBeNull();
    }
    if (role === 'OWNER') {
      await userEvent.press(screen.getByRole('button', { name: 'Ajustar stock' }));
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: '/products/[id]/stock-adjustment',
        params: { id: 'e' },
      });
    } else expect(screen.queryByRole('button', { name: 'Ajustar stock' })).toBeNull();
  });
test('detail pending/error/retry shows safe persisted archived product and historical category', async () => {
  const d = deferred<Awaited<ReturnType<typeof productsService.getById>>>();
  service.getById.mockReturnValueOnce(d.promise);
  await mountScreen(<ProductDetailScreen productId="e" />);
  expect(screen.getByText('Cargando producto…')).toBeTruthy();
  await act(async () => d.resolve({ data: null, error: productError('PRODUCT_NOT_FOUND') }));
  await screen.findByText('No se encontró el producto o no está disponible.');
  service.getById.mockResolvedValueOnce({
    data: { ...row(), category_id: 'archived-201', is_active: false },
    error: null,
  });
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Categoría: Accesorios históricos (archivada)');
  expect(screen.getByText('Archivado')).toBeTruthy();
});
test('detail without category does not lookup; route rejects array id; safe return fallback', async () => {
  service.getById.mockResolvedValueOnce({ data: { ...row(), category_id: null }, error: null });
  const h = await mountScreen(<ProductRoute />);
  await screen.findByText('Categoría: Sin categoría');
  expect(categoryService.getByIds).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button', { name: 'Volver a productos' }));
  expect(router.replace).toHaveBeenCalledWith('/products');
  await h.unmount();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: ['one', 'two'] });
  service.getById.mockClear();
  await mountScreen(<ProductRoute />);
  expect(service.getById).not.toHaveBeenCalled();
});
test('logout hides cached rows and blocks category/product reads', async () => {
  const h = await mountScreen(<ProductsScreen />);
  await screen.findByText('Peine');
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await h.rerender();
  expect(screen.queryByText('Peine')).toBeNull();
  expect(screen.getByText('Productos no disponibles')).toBeTruthy();
});
test('business change late page response cannot show previous product/category', async () => {
  const d = deferred<Awaited<ReturnType<typeof productsService.listByBusiness>>>();
  service.listByBusiness.mockReturnValueOnce(d.promise);
  const h = await mountScreen(<ProductsScreen />);
  context('other');
  service.listByBusiness.mockResolvedValue({
    data: {
      ...page('other'),
      items: [{ ...row('other', 'other'), name: 'Nuevo negocio', category_id: null }],
    },
    error: null,
  });
  await h.rerender();
  await screen.findByText('Nuevo negocio');
  await act(async () => d.resolve({ data: page(), error: null }));
  expect(screen.queryByText('Original')).toBeNull();
  expect(categoryService.getByIds).not.toHaveBeenCalled();
});
for (const mode of ['empty', 'one', 'duplicates'] as const)
  test(
    'D14 hook ' + mode + ' has deterministic set key and no redundant request on reorder',
    async () => {
      let ids = mode === 'empty' ? [] : mode === 'one' ? ['c'] : ['z', 'c', 'z'];
      let result!: ReturnType<typeof useProductCategoriesByIds>;
      function Probe() {
        result = useProductCategoriesByIds(ids);
        return null;
      }
      const h = await mountScreen(<Probe />);
      await waitFor(() => expect(result.status).toBe('success'));
      expect(categoryService.getByIds).toHaveBeenCalledTimes(mode === 'empty' ? 0 : 1);
      ids = mode === 'empty' ? [] : mode === 'one' ? ['c'] : ['c', 'z'];
      await h.rerender();
      expect(categoryService.getByIds).toHaveBeenCalledTimes(mode === 'empty' ? 0 : 1);
      await act(async () => result.refetch());
      expect(categoryService.getByIds).toHaveBeenCalledTimes(mode === 'empty' ? 0 : 2);
    },
  );
for (const change of ['page', 'business', 'unmount'] as const)
  test('D14 late ' + change + ' result isolated', async () => {
    let ids = ['old'];
    const d = deferred<Awaited<ReturnType<typeof productCategoriesService.getByIds>>>();
    categoryService.getByIds.mockReturnValueOnce(d.promise);
    let result!: ReturnType<typeof useProductCategoriesByIds>;
    function Probe() {
      result = useProductCategoriesByIds(ids);
      return null;
    }
    const h = await mountScreen(<Probe />);
    if (change === 'page') ids = ['new'];
    if (change === 'business') {
      context('other');
      categoryService.getByIds.mockResolvedValueOnce({ data: [], error: null });
    }
    if (change === 'unmount') await h.unmount();
    else await h.rerender();
    await act(async () => d.resolve({ data: [category('old')], error: null }));
    if (change !== 'unmount') {
      await waitFor(() => expect(result.status).toBe('success'));
      expect(result.data?.some((x) => x.id === 'old')).toBe(false);
    }
    expect(categoryService.getById).not.toHaveBeenCalled();
  });
