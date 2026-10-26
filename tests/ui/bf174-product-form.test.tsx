import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { productsService } from '@/features/products/services/productsService';
import { productCategoriesService } from '@/features/products/services/productCategoriesService';
import { productError } from '@/features/products/utils/productErrors';
import NewRoute from '@/app/(app)/products/new';
import EditRoute from '@/app/(app)/products/[id]/edit';
import { router, useLocalSearchParams } from 'expo-router';
import { routerMock } from '@/test/routerTestUtils';
import { renderWithProviders } from '@/test/renderWithProviders';
import { agendaContext } from './helpers/agendaFixture';
import type { ProductRow } from '@/features/products/types/product.types';
import type { ProductCategoryRow } from '@/features/products/repositories/productCategoriesRepository';
jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useLocalSearchParams: jest.fn(),
  router: { ...jest.requireActual('@/test/routerTestUtils').routerMock, canGoBack: jest.fn() },
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { getById: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: { listByBusiness: jest.fn(), getByIds: jest.fn() },
}));
const service = jest.mocked(productsService),
  cats = jest.mocked(productCategoriesService);
const row: ProductRow = {
  id: 'p',
  business_id: 'b',
  name: 'Original',
  description: null,
  sku: null,
  category_id: null,
  sale_price: 10.29,
  default_purchase_cost: 5,
  minimum_stock: 3,
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const category = (id = 'c', active = true, business_id = 'b'): ProductCategoryRow => ({
  id,
  business_id,
  name: id === 'c' ? 'Cabello' : 'Histórica',
  is_active: active,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
});
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'p' });
  jest.mocked(router.canGoBack).mockReturnValue(false);
  service.getById.mockResolvedValue({ data: row, error: null });
  service.create.mockImplementation(async (_b, input) => ({
    data: { ...row, ...input, id: 'persisted' },
    error: null,
  }));
  service.update.mockImplementation(async (_b, _id, input) => ({
    data: { ...row, ...input },
    error: null,
  }));
  cats.listByBusiness.mockImplementation(async (_b, p) => ({
    data: {
      items: [category()],
      page: p?.page ?? 1,
      pageSize: 25,
      hasNextPage: (p?.page ?? 1) === 1,
    },
    error: null,
  }));
  cats.getByIds.mockImplementation(async (_b, ids) => ({
    data: ids.map((id) => category(id)),
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
async function fill() {
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), '  Cera  ');
  await fireEvent.changeText(screen.getByLabelText('Precio de venta (obligatorio)'), '0.29');
  await fireEvent.changeText(
    screen.getByLabelText('Costo de compra de referencia (obligatorio)'),
    '0.00',
  );
}
test('BF174 create route uses approved fields, optional absence, exact DTO and persisted detail replace', async () => {
  const ui = await renderWithProviders(<NewRoute />);
  await fill();
  const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/products/[id]',
      params: { id: 'persisted' },
    }),
  );
  expect(service.create).toHaveBeenCalledWith('b', {
    name: '  Cera  ',
    sale_price: 0.29,
    default_purchase_cost: 0,
    minimum_stock: 0,
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products', 'b'] }, { throwOnError: true });
  expect(screen.queryByLabelText(/Stock actual|Imagen|Barcode/)).toBeNull();
});
test('BF174 required fields invalid, explicit zero price/cost accepted and no blank zero conversion', async () => {
  await renderWithProviders(<NewRoute />);
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  expect(service.create).not.toHaveBeenCalled();
  await screen.findByText(/Ingresa el nombre/);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Precio de venta (obligatorio)'), '0');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => expect(service.create).toHaveBeenCalledTimes(1));
});
test('BF174 category paging, active selection and explicit unclassified reuse existing readers', async () => {
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.press(await screen.findByRole('button', { name: 'Categoría: Cabello' }));
  await waitFor(() => expect(screen.getAllByText('Categoría: Cabello')).toHaveLength(2));
  await fireEvent.press(screen.getByRole('button', { name: 'Más categorías' }));
  await waitFor(() =>
    expect(cats.listByBusiness).toHaveBeenCalledWith('b', {
      page: 2,
      pageSize: 25,
      status: 'active',
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Sin categoría' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await waitFor(() =>
    expect(service.create).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ category_id: null }),
    ),
  );
});
test('BF174 selected category must remain active and same business; invalid selection blocks save', async () => {
  cats.getByIds.mockResolvedValue({ data: [category('c', true, 'foreign')], error: null });
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.press(await screen.findByRole('button', { name: 'Categoría: Cabello' }));
  await screen.findByText('Categoría: Categoría no disponible');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await screen.findByText(/Selecciona una categoría activa/);
  expect(service.create).not.toHaveBeenCalled();
});
test('BF174 edit route dirty-only PATCH and updated persisted detail navigation', async () => {
  await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), '  Nuevo  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(service.update).toHaveBeenCalledWith('b', 'p', { name: '  Nuevo  ' }));
  expect(routerMock.replace).toHaveBeenCalledWith({
    pathname: '/products/[id]',
    params: { id: 'p' },
  });
});
test('BF174 edit preserves nullable values until explicitly changed to empty text', async () => {
  await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  await fireEvent.changeText(screen.getByLabelText('Descripción'), '');
  await fireEvent.changeText(screen.getByLabelText('SKU'), '');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() =>
    expect(service.update).toHaveBeenCalledWith('b', 'p', { description: '', sku: '' }),
  );
});
test('BF174 archived assigned category is retained on edit, never offered as new choice', async () => {
  service.getById.mockResolvedValue({ data: { ...row, category_id: 'old' }, error: null });
  cats.getByIds.mockResolvedValue({ data: [category('old', false)], error: null });
  await renderWithProviders(<EditRoute />);
  await screen.findByText('Categoría: Histórica (archivada)');
  expect(screen.queryByRole('button', { name: 'Categoría: Histórica' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Nuevo');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(service.update).toHaveBeenCalledWith('b', 'p', { name: 'Nuevo' }));
});
test.each(['archive', 'restore'])(
  'BF174 %s is confirmed status-only, no dirty catalog/stock/history submitted',
  async (mode) => {
    service.getById.mockResolvedValue({
      data: { ...row, is_active: mode === 'archive' },
      error: null,
    });
    await renderWithProviders(<EditRoute />);
    await screen.findByDisplayValue('Original');
    await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Sin guardar');
    await fireEvent.press(
      screen.getByRole('button', {
        name: mode === 'archive' ? 'Archivar producto' : 'Restaurar producto',
      }),
    );
    expect(service.update).not.toHaveBeenCalled();
    await fireEvent.press(
      await screen.findByRole('button', {
        name: mode === 'archive' ? 'Confirmar archivo' : 'Confirmar restauración',
      }),
    );
    await waitFor(() =>
      expect(service.update).toHaveBeenCalledWith('b', 'p', { is_active: mode !== 'archive' }),
    );
  },
);
test.each(['new', 'edit'])(
  'BF174 %s cancelled without a write, safe collection fallback',
  async (mode) => {
    await renderWithProviders(mode === 'new' ? <NewRoute /> : <EditRoute />);
    if (mode === 'edit') await screen.findByDisplayValue('Original');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(routerMock.replace).toHaveBeenCalledWith('/products');
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  },
);
test.each(['PRODUCT_ACCESS_DENIED', 'NETWORK_ERROR', 'UNKNOWN_ERROR'] as const)(
  'BF174 safe %s error preserves draft and does not navigate',
  async (code) => {
    service.create.mockResolvedValue({ data: null, error: productError(code) });
    await renderWithProviders(<NewRoute />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
    await screen.findByText(productError(code).message);
    expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('  Cera  ');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledTimes(1);
  },
);
test('BF174 pending prevents duplicate create, cancel or input alteration', async () => {
  let finish!: (v: Awaited<ReturnType<typeof productsService.create>>) => void;
  service.create.mockReturnValue(
    new Promise((r) => {
      finish = r;
    }),
  );
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await screen.findByText('Guardando producto…');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'late');
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('  Cera  ');
  expect(service.create).toHaveBeenCalledTimes(1);
  expect(routerMock.replace).not.toHaveBeenCalled();
  await act(() => finish({ data: row, error: null }));
});
test.each(['user', 'business', 'membership', 'role', 'logout'])(
  'BF174 pending result after %s switch cannot navigate or invalidate',
  async (change) => {
    let finish!: (v: Awaited<ReturnType<typeof productsService.create>>) => void;
    service.create.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const ui = await renderWithProviders(<NewRoute />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
    await screen.findByText('Guardando producto…');
    const invalidate = jest.spyOn(ui.queryClient, 'invalidateQueries');
    if (change === 'user') agendaContext({ userId: 'new' });
    if (change === 'business') agendaContext({ businessId: 'new' });
    if (change === 'membership') agendaContext({ membershipId: 'new' });
    if (change === 'role') agendaContext({ role: 'BARBER' });
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    await ui.rerender(<NewRoute />);
    await act(() => finish({ data: row, error: null }));
    expect(invalidate).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledTimes(1);
  },
);
test.each(['new', 'edit'])('BF174 BARBER blocked on direct %s route', async (mode) => {
  agendaContext({ role: 'BARBER' });
  await renderWithProviders(mode === 'new' ? <NewRoute /> : <EditRoute />);
  await screen.findByText('Acceso restringido');
  expect(service.getById).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
});
test('BF174 route malformed or foreign detail never exposes an editable product', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: ['p', 'q'] });
  const ui = await renderWithProviders(<EditRoute />);
  await screen.findByText('Producto no disponible');
  expect(service.getById).not.toHaveBeenCalled();
  service.getById.mockResolvedValue({ data: { ...row, business_id: 'foreign' }, error: null });
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'p' });
  await ui.rerender(<EditRoute />);
  await screen.findByText('Producto no disponible');
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
});
test('BF174 successful write survives read-refresh failure, no automatic write retry', async () => {
  const ui = await renderWithProviders(<NewRoute />);
  await fill();
  jest.spyOn(ui.queryClient, 'invalidateQueries').mockRejectedValueOnce(Error('private refresh'));
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/products/[id]',
      params: { id: 'persisted' },
    }),
  );
  expect(service.create).toHaveBeenCalledTimes(1);
});

test('BF174 confirmed edit survives actual detail refetch error without unmounting its pending outcome', async () => {
  await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Guardado');
  service.getById.mockResolvedValue({ data: null, error: productError('NETWORK_ERROR') });
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/products/[id]',
      params: { id: 'p' },
    }),
  );
  expect(service.update).toHaveBeenCalledTimes(1);
});
test('BF174 background detail refresh preserves dirty draft and product switch resets it', async () => {
  const ui = await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Borrador');
  service.getById.mockResolvedValue({ data: { ...row, name: 'Servidor' }, error: null });
  await act(() => ui.queryClient.invalidateQueries({ queryKey: ['products', 'b'] }));
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Borrador');
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'other' });
  service.getById.mockResolvedValue({ data: { ...row, id: 'other', name: 'Otro' }, error: null });
  await ui.rerender(<EditRoute />);
  await screen.findByDisplayValue('Otro');
});

test('BF174 complete create preserves text/empty metadata and chosen category; no SKU uniqueness invented', async () => {
  await renderWithProviders(<NewRoute />);
  await fill();
  await fireEvent.changeText(screen.getByLabelText('Descripción'), '');
  await fireEvent.changeText(screen.getByLabelText('SKU'), '  BF-CAB-001  ');
  await fireEvent.changeText(screen.getByLabelText('Stock mínimo'), '4');
  await fireEvent.press(await screen.findByRole('button', { name: 'Categoría: Cabello' }));
  await waitFor(() => expect(cats.getByIds).toHaveBeenCalledWith('b', ['c']));
  await waitFor(() => expect(screen.getAllByText('Categoría: Cabello')).toHaveLength(2));
  await fireEvent.press(screen.getByRole('button', { name: 'Crear producto' }));
  await waitFor(() =>
    expect(service.create).toHaveBeenCalledWith('b', {
      name: '  Cera  ',
      description: '',
      sku: '  BF-CAB-001  ',
      sale_price: 0.29,
      default_purchase_cost: 0,
      minimum_stock: 4,
      category_id: 'c',
    }),
  );
  expect(service.getById).not.toHaveBeenCalled();
});
test('BF174 edit error preserves input and archive failure remains safely retryable without sending dirty fields', async () => {
  service.update.mockResolvedValue({ data: null, error: productError('NETWORK_ERROR') });
  await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Borrador');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await screen.findByText(productError('NETWORK_ERROR').message);
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Borrador');
  await fireEvent.press(screen.getByRole('button', { name: 'Archivar producto' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirmar archivo' }));
  await waitFor(() =>
    expect(service.update).toHaveBeenLastCalledWith('b', 'p', { is_active: false }),
  );
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('BF174 edit loading and not-found/error are not an empty editable form', async () => {
  let finish!: (v: Awaited<ReturnType<typeof productsService.getById>>) => void;
  service.getById.mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await renderWithProviders(<EditRoute />);
  await screen.findByText('Cargando producto…');
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
  await act(() => finish({ data: null, error: productError('PRODUCT_NOT_FOUND') }));
  await screen.findByText('No se encontró el producto o no está disponible.');
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
});
test('BF174 category error never becomes an empty success; existing read retry only', async () => {
  cats.listByBusiness.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'private' },
  });
  await renderWithProviders(<NewRoute />);
  await screen.findByText('No se pudieron cargar las categorías.');
  expect(screen.queryByText('private')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('button', { name: 'Categoría: Cabello' });
  expect(service.create).not.toHaveBeenCalled();
});

test('BF174 late edit completion after product route switch cannot navigate or affect new draft', async () => {
  let finish!: (v: Awaited<ReturnType<typeof productsService.update>>) => void;
  service.update.mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const ui = await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Viejo');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await screen.findByText('Guardando producto…');
  const invalidation = jest.spyOn(ui.queryClient, 'invalidateQueries');
  service.getById.mockResolvedValue({ data: { ...row, id: 'other', name: 'Otro' }, error: null });
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'other' });
  await ui.rerender(<EditRoute />);
  await screen.findByDisplayValue('Otro');
  await act(() => finish({ data: { ...row, name: 'Viejo' }, error: null }));
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(invalidation).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Otro');
  expect(service.update).toHaveBeenCalledTimes(1);
});

test('BF174 failed background read retains dirty draft, blocks writes and still permits safe cancel', async () => {
  const ui = await renderWithProviders(<EditRoute />);
  await screen.findByDisplayValue('Original');
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Borrador');
  service.getById.mockResolvedValue({ data: null, error: productError('NETWORK_ERROR') });
  await act(() => ui.queryClient.invalidateQueries({ queryKey: ['products', 'b'] }));
  await screen.findByText(productError('NETWORK_ERROR').message);
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Borrador');
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(service.update).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(routerMock.replace).toHaveBeenCalledWith('/products');
});
