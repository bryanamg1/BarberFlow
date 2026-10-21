import type { Session } from '@supabase/supabase-js';
import { cloneElement, type ReactElement } from 'react';
import { defaultScheduler, notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useIsFocused, router } from 'expo-router';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { productsService } from '@/features/products/services/productsService';
import { productCategoriesService } from '@/features/products/services/productCategoriesService';
import { ProductStockBadge } from '@/features/products/components/ProductStockBadge';
import { ProductsScreen } from '@/features/products/screens/ProductsScreen';
import { ProductDetailScreen } from '@/features/products/screens/ProductDetailScreen';
import type { ProductStockValue } from '@/features/products/types/productStock.types';
import type { ProductRow } from '@/features/products/types/product.types';
import { createTestQueryClient } from '@/test/createTestQueryClient';
jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { listByBusiness: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: { getByIds: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn(), getLowStockProducts: jest.fn() },
}));
const inventory = jest.mocked(inventoryService),
  products = jest.mocked(productsService);
const at = '2026-01-01T00:00:00Z';
const businessMock = jest.mocked(useBusiness);
const row = (id = 'p', active = true): ProductRow => ({
  id,
  business_id: 'b',
  category_id: null,
  name: 'Producto ' + id,
  description: null,
  sku: null,
  sale_price: 10,
  default_purchase_cost: 5,
  minimum_stock: 3,
  is_active: active,
  created_at: at,
  updated_at: at,
});
function context(businessId = 'b', role: 'OWNER' | 'BARBER' = 'OWNER') {
  const session: Session = {
    access_token: 'test-only',
    refresh_token: 'test-only',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: 'u', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: at },
  };
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'authenticated', session, user: session.user, error: null });
  businessMock.mockReturnValue({
    status: 'success',
    error: null,
    isFetching: false,
    data: {
      membershipId: 'member-' + businessId,
      role,
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(element: ReactElement) {
  const client = createTestQueryClient();
  const tree = () => (
    <QueryClientProvider client={client}>{cloneElement(element)}</QueryClientProvider>
  );
  const view = await render(tree());
  return {
    client,
    rerender: (next = element) =>
      view.rerender(
        <QueryClientProvider client={client}>{cloneElement(next)}</QueryClientProvider>,
      ),
    unmount: () => view.unmount(),
  };
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  jest.mocked(useIsFocused).mockReturnValue(true);
  products.listByBusiness.mockImplementation(async (_b, p) => ({
    data: {
      items: [row('p'), row('zero'), row('archived', false)].filter(
        (r) => p?.status === 'all' || (p?.status !== 'inactive') === r.is_active,
      ),
      page: p?.page ?? 1,
      pageSize: 25,
      hasNextPage: false,
    },
    error: null,
  }));
  products.getById.mockImplementation(async (b, id) => ({
    data: { ...row(id, id !== 'archived'), business_id: b },
    error: null,
  }));
  inventory.getProductStock.mockImplementation(async (_b, ids) => ({
    data: ids.map((product_id) => ({
      product_id,
      current_stock:
        product_id === 'zero' ? '0' : product_id === 'archived' ? '9007199254740993' : '2',
    })),
    error: null,
  }));
  jest.mocked(productCategoriesService.getByIds).mockResolvedValue({ data: [], error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const badgeCases: readonly [ProductStockValue, number, string][] = [
  [{ status: 'success', value: '8' }, 3, 'Stock: 8 · Normal'],
  [{ status: 'success', value: '0' }, 3, 'Stock: 0 · Sin stock'],
  [{ status: 'success', value: '3' }, 3, 'Stock: 3 · Stock bajo'],
  [{ status: 'success', value: '1' }, 3, 'Stock: 1 · Stock bajo'],
  [{ status: 'success', value: '9007199254740993' }, 3, 'Stock: 9007199254740993 · Normal'],
  [{ status: 'pending' }, 3, 'Cargando stock…'],
  [{ status: 'unavailable' }, 3, 'Stock no disponible'],
  [
    { status: 'error', error: { code: 'NETWORK_ERROR', message: 'private' } },
    3,
    'Error al cargar stock',
  ],
  [{ status: 'success', value: '-1' }, 3, 'Stock no disponible'],
];
test.each(badgeCases)(
  'badge %j exposes accessible text without any data access',
  async (stock, minimum, label) => {
    await render(<ProductStockBadge stock={stock} minimumStock={minimum} />);
    expect(screen.getByRole('status', { name: label })).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
    expect(inventory.getProductStock).not.toHaveBeenCalled();
  },
);
test('list uses one current-page batch, shows zero and low with accessible row labels, no alerts', async () => {
  await mount(<ProductsScreen />);
  await screen.findByText('Stock: 0 · Sin stock');
  expect(screen.getByText('Stock: 2 · Stock bajo')).toBeTruthy();
  expect(inventory.getProductStock).toHaveBeenCalledTimes(1);
  expect(inventory.getProductStock).toHaveBeenCalledWith('b', ['p', 'zero']);
  await userEvent.press(
    screen.getByRole('button', { name: 'Ver producto Producto p, Activo. Stock: 2 · Stock bajo' }),
  );
  expect(router.push).toHaveBeenCalledWith({ pathname: '/products/[id]', params: { id: 'p' } });
  expect(inventory.getLowStockProducts).not.toHaveBeenCalled();
});
test('archived product retains its real exact stock after status filter', async () => {
  await mount(<ProductsScreen />);
  await screen.findByText('Stock: 0 · Sin stock');
  await userEvent.press(screen.getByRole('button', { name: 'Archivados' }));
  await screen.findByText('Stock: 9007199254740993 · Normal');
  expect(screen.getByText('Archivado')).toBeTruthy();
  expect(inventory.getProductStock).toHaveBeenLastCalledWith('b', ['archived']);
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s detail consumes single-stock hook and preserves catalog fields',
  async (role) => {
    context('b', role);
    await mount(<ProductDetailScreen productId="p" />);
    await screen.findByRole('status', { name: 'Stock: 2 · Stock bajo' });
    expect(screen.getByText('Stock mínimo: 3')).toBeTruthy();
    expect(inventory.getProductStock).toHaveBeenCalledWith('b', ['p']);
    expect(Boolean(screen.queryByRole('button', { name: 'Ajustar stock' }))).toBe(role === 'OWNER');
  },
);
test('stock pending and missing data remain distinct from zero without hiding product', async () => {
  const d = deferred<Awaited<ReturnType<typeof inventoryService.getProductStock>>>();
  inventory.getProductStock.mockReturnValueOnce(d.promise);
  await mount(<ProductDetailScreen productId="p" />);
  await screen.findByText('Cargando stock…');
  expect(screen.getByText('Producto p')).toBeTruthy();
  await act(async () => d.resolve({ data: [], error: null }));
  await screen.findByText('Stock no disponible');
  expect(screen.queryByText('Stock: 0 · Sin stock')).toBeNull();
});
test('safe stock error keeps detail and accessible retry restores value without financial write', async () => {
  inventory.getProductStock.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'private SQL' },
  });
  await mount(<ProductDetailScreen productId="p" />);
  await screen.findByText('Error al cargar stock');
  expect(screen.getByText('Producto p')).toBeTruthy();
  expect(screen.queryByText('private SQL')).toBeNull();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Stock: 2 · Stock bajo');
  expect(inventory.getProductStock).toHaveBeenCalledTimes(2);
});
test('page change replaces stock ID set, old batch response cannot label next page', async () => {
  products.listByBusiness.mockImplementation(async (_b, p) => ({
    data: {
      items: [row(p?.page === 2 ? 'next' : 'p')],
      page: p?.page ?? 1,
      pageSize: 25,
      hasNextPage: p?.page === 1,
    },
    error: null,
  }));
  const d = deferred<Awaited<ReturnType<typeof inventoryService.getProductStock>>>();
  inventory.getProductStock.mockReturnValueOnce(d.promise);
  await mount(<ProductsScreen />);
  await screen.findByText('Cargando stock…');
  await userEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByText('Stock: 2 · Stock bajo');
  await act(async () =>
    d.resolve({ data: [{ product_id: 'p', current_stock: '999' }], error: null }),
  );
  expect(screen.queryByText(/Stock: 999/)).toBeNull();
  expect(inventory.getProductStock).toHaveBeenLastCalledWith('b', ['next']);
});
test('logout hides stock and late response never shows in next business', async () => {
  const d = deferred<Awaited<ReturnType<typeof inventoryService.getProductStock>>>();
  inventory.getProductStock.mockReturnValueOnce(d.promise);
  const h = await mount(<ProductDetailScreen productId="p" />);
  await screen.findByText('Cargando stock…');
  context('other');
  await h.rerender();
  await screen.findByText('Stock: 2 · Stock bajo');
  await act(async () =>
    d.resolve({ data: [{ product_id: 'p', current_stock: '999' }], error: null }),
  );
  expect(screen.queryByText(/Stock: 999/)).toBeNull();
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await h.rerender();
  expect(screen.queryByText(/Stock: 2/)).toBeNull();
});
test('detail product change replaces stock and no old ID is shown', async () => {
  const h = await mount(<ProductDetailScreen productId="zero" />);
  await screen.findByText('Stock: 0 · Sin stock');
  await h.rerender(<ProductDetailScreen productId="archived" />);
  await screen.findByText('Stock: 9007199254740993 · Normal');
  expect(screen.queryByText('Stock: 0 · Sin stock')).toBeNull();
  await waitFor(() =>
    expect(inventory.getProductStock).toHaveBeenLastCalledWith('b', ['archived']),
  );
});
