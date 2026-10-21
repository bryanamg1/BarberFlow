import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import AdjustmentRoute from '@/app/(app)/products/[id]/stock-adjustment';
import ProductDetail from '@/app/(app)/products/[id]';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { StockAdjustmentScreen } from '@/features/inventory/screens/StockAdjustmentScreen';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { productsService } from '@/features/products/services/productsService';
import type { AdjustStockInput } from '@/features/inventory/schemas/stockAdjustment.schema';
import type { StockMovementRow } from '@/features/inventory/types/inventory.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => {
  const { routerMock } = jest.requireActual('@/test/routerTestUtils');
  return { router: routerMock, useLocalSearchParams: jest.fn(), useIsFocused: jest.fn() };
});
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { adjustStock: jest.fn(), getProductStock: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { getById: jest.fn() },
}));
jest.mock('@/features/products/services/productCategoriesService', () => ({
  productCategoriesService: { getByIds: jest.fn() },
}));
jest.mock('@/features/inventory/repositories/inventoryRepository', () => {
  throw new Error('UI imported repository');
});
jest.mock('@/lib/supabase/client', () => {
  throw new Error('UI imported Supabase');
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const b = '00000000-0000-4000-8000-000000000224';
const p = '00000000-0000-4000-8000-000000000225';
const op = '00000000-0000-4000-8000-000000000226';
const other = '00000000-0000-4000-8000-000000000227';
const businessMock = jest.mocked(useBusiness),
  service = jest.mocked(inventoryService),
  authMock = jest.mocked(useAuth);
const setLocalSearchParams = (params: { id: string | string[] }) =>
  jest.mocked(useLocalSearchParams).mockReturnValue(params);
const business = (id = b, role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'membership-' + id,
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const auth = (id = op) =>
  ({ status: 'authenticated', user: { id }, session: {}, error: null }) as ReturnType<
    typeof useAuth
  >;
const row = (input: AdjustStockInput): StockMovementRow => ({
  id: op,
  business_id: b,
  product_id: input.productId,
  type: input.reason,
  quantity_delta: input.quantityDelta,
  unit_cost: null,
  reference_type: 'STOCK_ADJUSTMENT',
  reference_id: input.operationId,
  notes: input.notes ?? null,
  occurred_at: '2026-01-01T00:00:00Z',
  created_by: op,
  created_at: '2026-01-01T00:00:00Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
async function ready() {
  const view = await renderWithProviders(<StockAdjustmentScreen />);
  await screen.findByText('Saldo actual: 10');
  return view;
}
async function review(quantity = '-2') {
  await fireEvent.changeText(screen.getByLabelText('Cantidad del ajuste'), quantity);
  await press('Revisar ajuste');
  await screen.findByText('Confirmar ajuste de stock');
}
beforeEach(() => {
  resetRouterMocks();
  setLocalSearchParams({ id: p });
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.spyOn(uuid, 'v4').mockReturnValue(op);
  businessMock.mockReturnValue(business());
  authMock.mockReturnValue(auth());
  jest.mocked(productsService.getById).mockResolvedValue({
    data: {
      id: p,
      business_id: b,
      category_id: null,
      name: 'Producto persistido',
      description: null,
      sku: null,
      sale_price: 12,
      default_purchase_cost: 6,
      minimum_stock: 0,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    error: null,
  });
  service.getProductStock.mockResolvedValue({
    data: [{ product_id: p, current_stock: '10' }],
    error: null,
  });
  service.adjustStock.mockImplementation(async (_businessId, input) => ({
    data: row(input),
    error: null,
  }));
});

test('thin route and detail OWNER entry target the selected product', async () => {
  expect(AdjustmentRoute).toBe(StockAdjustmentScreen);
  await renderWithProviders(<ProductDetail />);
  await screen.findByText('Producto persistido');
  await press('Ajustar stock');
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/products/[id]/stock-adjustment',
    params: { id: p },
  });
});
test('OWNER reads derived stock and confirms before exactly one RPC-backed service call', async () => {
  await ready();
  await fireEvent.changeText(screen.getByLabelText('Notas (opcional)'), ' Original\n ');
  await review('+3');
  expect(service.getProductStock).toHaveBeenCalledWith(b, [p]);
  expect(service.adjustStock).not.toHaveBeenCalled();
  await press('Confirmar ajuste');
  await screen.findByText('Ajuste registrado: +3 unidades.');
  expect(service.adjustStock).toHaveBeenCalledTimes(1);
  expect(service.adjustStock).toHaveBeenCalledWith(b, {
    operationId: op,
    productId: p,
    quantityDelta: 3,
    reason: 'ADJUSTMENT',
    notes: ' Original\n ',
  });
});
test('BARBER has no administrative form or stock request', async () => {
  businessMock.mockReturnValue(business(b, 'BARBER'));
  await renderWithProviders(<StockAdjustmentScreen />);
  expect(screen.getByText('Acceso restringido')).toBeOnTheScreen();
  expect(service.getProductStock).not.toHaveBeenCalled();
  expect(service.adjustStock).not.toHaveBeenCalled();
});
test.each(['recovering', 'unauthenticated', 'initializing'] as const)(
  '%s cannot read or adjust',
  async (status) => {
    authMock.mockReturnValue({ ...auth(), status } as ReturnType<typeof useAuth>);
    await renderWithProviders(<StockAdjustmentScreen />);
    expect(screen.getByText('Sesión no disponible')).toBeOnTheScreen();
    expect(service.getProductStock).not.toHaveBeenCalled();
  },
);
test('invalid product route, missing business and pending context cannot submit', async () => {
  setLocalSearchParams({ id: [p, other] });
  const view = await renderWithProviders(<StockAdjustmentScreen />);
  expect(screen.getByText('Producto no disponible')).toBeOnTheScreen();
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await view.rerender(<StockAdjustmentScreen />);
  expect(screen.getByText('Negocio no disponible')).toBeOnTheScreen();
  businessMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  await view.rerender(<StockAdjustmentScreen />);
  expect(screen.getByText('Cargando negocio…')).toBeOnTheScreen();
  expect(service.getProductStock).not.toHaveBeenCalled();
});
test('missing product is unavailable, never fabricated zero', async () => {
  service.getProductStock.mockResolvedValue({ data: [], error: null });
  await renderWithProviders(<StockAdjustmentScreen />);
  await screen.findByText('El producto no está disponible.');
  expect(screen.queryByText('Saldo actual: 0')).toBeNull();
  expect(screen.getByRole('button', { name: 'Revisar ajuste' })).toBeDisabled();
});
test('read failure is explicit and retry restores exact integer-string stock', async () => {
  service.getProductStock
    .mockResolvedValueOnce({
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
    })
    .mockResolvedValue({
      data: [{ product_id: p, current_stock: '9007199254740993' }],
      error: null,
    });
  await renderWithProviders(<StockAdjustmentScreen />);
  await screen.findByText('Sin conexión');
  await press('Reintentar');
  await screen.findByText('Saldo actual: 9007199254740993');
});
test.each(['', '0', '1.5', '3oops', '2147483648'])(
  'invalid quantity %s never opens confirmation or writes',
  async (value) => {
    await ready();
    await fireEvent.changeText(screen.getByLabelText('Cantidad del ajuste'), value);
    await press('Revisar ajuste');
    await waitFor(() =>
      expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp(
        'accessibilityHint',
        expect.stringContaining('Error:'),
      ),
    );
    expect(screen.queryByText('Confirmar ajuste de stock')).toBeNull();
    expect(service.adjustStock).not.toHaveBeenCalled();
  },
);
test('LOSS requires negative quantity and sends its exact reason', async () => {
  await ready();
  await press('Pérdida');
  await fireEvent.changeText(screen.getByLabelText('Cantidad del ajuste'), '2');
  await press('Revisar ajuste');
  await screen.findByText('Error: Una pérdida debe tener una cantidad negativa.');
  await review('-2');
  await press('Confirmar ajuste');
  await screen.findByText('Ajuste registrado: -2 unidades.');
  expect(service.adjustStock.mock.calls[0][1].reason).toBe('LOSS');
});
test('cancel confirmation performs no write and keeps editable draft', async () => {
  await ready();
  await review();
  await press('Cerrar');
  expect(service.adjustStock).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp('value', '-2');
  expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp('editable', true);
});
test('double submit is blocked through asynchronous validation and pending request', async () => {
  const pending = deferred<Awaited<ReturnType<typeof inventoryService.adjustStock>>>();
  service.adjustStock.mockReturnValue(pending.promise);
  await ready();
  await fireEvent.changeText(screen.getByLabelText('Cantidad del ajuste'), '-2');
  const button = screen.getByRole('button', { name: 'Revisar ajuste' });
  await act(async () => {
    await fireEvent.press(button);
    await fireEvent.press(button);
  });
  await screen.findByText('Confirmar ajuste de stock');
  const confirm = screen.getByRole('button', { name: 'Confirmar ajuste' });
  await act(async () => {
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
  });
  expect(service.adjustStock).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp('editable', false);
  await act(async () =>
    pending.resolve({ data: row(service.adjustStock.mock.calls[0][1]), error: null }),
  );
  await screen.findByText('Ajuste registrado: -2 unidades.');
});
test('lost response retains immutable payload and UUID across explicit retry', async () => {
  service.adjustStock.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'private ignored' },
  });
  await ready();
  await review();
  await press('Confirmar ajuste');
  await screen.findByRole('button', { name: 'Reintentar mismo ajuste' });
  expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp('editable', false);
  expect(screen.queryByRole('button', { name: 'Modificar ajuste' })).toBeNull();
  await press('Reintentar mismo ajuste');
  await screen.findByText('Ajuste registrado: -2 unidades.');
  expect(service.adjustStock.mock.calls[1]).toEqual(service.adjustStock.mock.calls[0]);
});
test('insufficient stock preserves form and permits a new explicit intention', async () => {
  service.adjustStock.mockResolvedValue({
    data: null,
    error: { code: 'INSUFFICIENT_STOCK', message: 'ignored' },
  });
  await ready();
  await review();
  await press('Confirmar ajuste');
  await screen.findByRole('button', { name: 'Reintentar mismo ajuste' });
  expect(screen.getAllByText('Stock insuficiente para aplicar el ajuste.').length).toBeGreaterThan(
    0,
  );
  await press('Cerrar');
  jest.spyOn(uuid, 'v4').mockReturnValue(other);
  await press('Modificar ajuste');
  await review('-1');
  await press('Confirmar ajuste');
  await waitFor(() => expect(service.adjustStock).toHaveBeenCalledTimes(2));
  expect(service.adjustStock.mock.calls[1][1].operationId).toBe(other);
});
test('late success invalidates only captured business and never resets the new business draft', async () => {
  const pending = deferred<Awaited<ReturnType<typeof inventoryService.adjustStock>>>();
  service.adjustStock.mockReturnValue(pending.promise);
  const view = await ready();
  const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
  await review();
  await press('Confirmar ajuste');
  businessMock.mockReturnValue(business(other));
  await view.rerender(<StockAdjustmentScreen />);
  await screen.findByText('Saldo actual: 10');
  await fireEvent.changeText(screen.getByLabelText('Cantidad del ajuste'), '+7');
  await act(async () =>
    pending.resolve({ data: row(service.adjustStock.mock.calls[0][1]), error: null }),
  );
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: inventoryKeys.byBusiness(b) }),
  );
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: inventoryKeys.byBusiness(other) });
  expect(screen.queryByText('Ajuste registrado: -2 unidades.')).toBeNull();
  expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp('value', '+7');
});
test('actor or product change discards old confirmation and draft', async () => {
  const view = await ready();
  await review();
  authMock.mockReturnValue(auth(other));
  await view.rerender(<StockAdjustmentScreen />);
  await screen.findByLabelText('Cantidad del ajuste');
  expect(screen.queryByText('Confirmar ajuste de stock')).toBeNull();
  expect(screen.getByLabelText('Cantidad del ajuste')).toHaveProp('value', '');
  setLocalSearchParams({ id: other });
  service.getProductStock.mockResolvedValue({
    data: [{ product_id: other, current_stock: '0' }],
    error: null,
  });
  await view.rerender(<StockAdjustmentScreen />);
  await screen.findByText('Saldo actual: 0');
  expect(service.adjustStock).not.toHaveBeenCalled();
});
test('server replay result is displayed and new intent generates a fresh key', async () => {
  service.adjustStock.mockResolvedValue({
    data: row({ operationId: op, productId: other, quantityDelta: 4, reason: 'ADJUSTMENT' }),
    error: null,
  });
  await ready();
  await review();
  await press('Confirmar ajuste');
  await screen.findByText('Ajuste registrado: +4 unidades.');
  jest.spyOn(uuid, 'v4').mockReturnValue(other);
  await press('Nuevo ajuste');
  await review('+1');
  await press('Confirmar ajuste');
  await waitFor(() => expect(service.adjustStock).toHaveBeenCalledTimes(2));
  expect(service.adjustStock.mock.calls[1][1].operationId).toBe(other);
});
test('safe exit uses Products destination', async () => {
  await ready();
  await press('Volver a Productos');
  expect(routerMock.dismissTo).toHaveBeenCalledWith('/products');
});
