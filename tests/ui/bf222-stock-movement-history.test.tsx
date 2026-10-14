import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { Text } from 'react-native';

import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { StockMovementHistory } from '@/features/inventory/components/StockMovementHistory';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import {
  useStockMovements,
  type UseStockMovementsResult,
} from '@/features/inventory/hooks/useStockMovements';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import type {
  StockMovementRow,
  StockMovementType,
} from '@/features/inventory/types/inventory.types';
import type {
  StockMovementFilters,
  StockMovementHistoryResult,
} from '@/features/inventory/types/stockMovementHistory.types';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { listStockMovements: jest.fn() },
}));
jest.mock('@/features/inventory/repositories/inventoryRepository', () => {
  throw new Error('History UI imported repository');
});
jest.mock('@/lib/supabase/client', () => {
  throw new Error('History UI imported Supabase');
});
const businessMock = jest.mocked(useBusiness),
  service = jest.mocked(inventoryService);
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm',
    role,
    business: {
      id,
      name: 'Demo',
      currency_code: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
});
const row = (patch: Partial<StockMovementRow> = {}): StockMovementRow => ({
  id: 'm',
  business_id: 'b',
  product_id: 'p',
  type: 'PURCHASE',
  quantity_delta: 3,
  unit_cost: null,
  reference_type: null,
  reference_id: null,
  notes: 'Nota original',
  occurred_at: '2026-01-01T03:30:00Z',
  created_by: 'opaque-creator',
  created_at: '2026-01-01T03:30:00Z',
  ...patch,
});
const page = (items = [row()], number = 1, hasNextPage = false): StockMovementHistoryResult => ({
  data: { items, page: number, pageSize: 25, hasNextPage },
  error: null,
});
const failure: StockMovementHistoryResult = {
  data: null,
  error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' },
};
const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let latest: UseStockMovementsResult;
function Probe({
  productId = 'p',
  page = 1,
  pageSize = 25,
  filters = {},
}: {
  productId?: string | null;
  page?: number;
  pageSize?: number;
  filters?: StockMovementFilters;
}) {
  const current = useStockMovements(productId, page, pageSize, filters);
  useLayoutEffect(() => {
    latest = current;
  });
  return <Text>{current.status}</Text>;
}
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler(defaultScheduler));
beforeEach(() => {
  businessMock.mockReturnValue(business());
  service.listStockMovements.mockResolvedValue(page());
});

test.each(['OWNER', 'BARBER'] as const)(
  '%s reads immutable history without edit/delete/adjustment controls or creator joins',
  async (role) => {
    businessMock.mockReturnValue(business('b', role));
    await renderWithProviders(<StockMovementHistory productId="p" />);
    await waitFor(() => expect(screen.getByText('Notas: Nota original')).toBeTruthy());
    expect(service.listStockMovements).toHaveBeenCalledWith('b', 'p', { page: 1, pageSize: 25 });
    expect(
      screen.queryByRole('button', { name: /Editar|Eliminar|Borrar|Ajustar|Deshacer/ }),
    ).toBeNull();
    expect(screen.queryByText('opaque-creator')).toBeNull();
    // ICU can express midnight in 12h or 24h form; both must be 00:30 in the business zone.
    expect(
      screen.getByText(/(?:0:30|12:30 a\.\s*m\.).*America\/Argentina\/Buenos_Aires/),
    ).toBeTruthy();
  },
);
test.each([
  ['PURCHASE', 'Compra', 4],
  ['SALE', 'Venta', -2],
  ['LOSS', 'Pérdida', 3],
  ['ADJUSTMENT', 'Ajuste', -7],
  ['RETURN', 'Devolución', -5],
] as const)(
  '%s shows label %s and direction from signed delta %s',
  async (type, label, quantity_delta) => {
    service.listStockMovements.mockResolvedValue(page([row({ type, quantity_delta })]));
    await renderWithProviders(<StockMovementHistory productId="p" />);
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
    expect(
      screen.getByLabelText(`Cantidad ${quantity_delta > 0 ? '+' : ''}${quantity_delta}`),
    ).toBeTruthy();
  },
);
test('nullable unit cost is omitted, while actual zero cost is displayed as zero; reference/notes remain original', async () => {
  service.listStockMovements.mockResolvedValue(
    page([
      row({
        notes: '  Texto\nOriginal  ',
        reference_type: 'free text',
        reference_id: 'reference-opaque',
      }),
    ]),
  );
  const view = await renderWithProviders(<StockMovementHistory productId="p" />);
  await waitFor(() => expect(screen.getByText('Notas:   Texto\nOriginal  ')).toBeTruthy());
  expect(screen.queryByText(/^Costo unitario:/)).toBeNull();
  expect(screen.getByText('Referencia: free text')).toBeTruthy();
  expect(screen.getByText('ID de referencia: reference-opaque')).toBeTruthy();
  service.listStockMovements.mockResolvedValue(page([row({ unit_cost: 0 })]));
  await view.rerender(<StockMovementHistory productId="other" />);
  await waitFor(() => expect(screen.getByText(/^Costo unitario:.*0,00/)).toBeTruthy());
});
test('server row order is preserved, without local sorting or exact counts', async () => {
  service.listStockMovements.mockResolvedValue(
    page([
      row({ id: 'z', type: 'RETURN', notes: 'Primera' }),
      row({ id: 'a', type: 'PURCHASE', notes: 'Segunda' }),
    ]),
  );
  await renderWithProviders(<StockMovementHistory productId="p" />);
  await waitFor(() => expect(screen.getAllByText(/^Notas:/)).toHaveLength(2));
  expect(screen.getAllByText(/^Notas:/).map((node) => node.props.children)).toEqual([
    ['Notas: ', 'Primera'],
    ['Notas: ', 'Segunda'],
  ]);
  expect(screen.queryByText(/Total de movimientos|Página .* de /)).toBeNull();
});
test('pending and empty states do not manufacture stock or a not-found error', async () => {
  const pending = deferred<StockMovementHistoryResult>();
  service.listStockMovements.mockReturnValue(pending.promise);
  await renderWithProviders(<StockMovementHistory productId="p" />);
  expect(screen.getByText('Cargando movimientos…')).toBeTruthy();
  await act(async () => pending.resolve(page([])));
  expect(screen.getByText('No hay movimientos de stock.')).toBeTruthy();
  expect(screen.queryByText(/Stock actual|Producto inexistente|Costo unitario:/)).toBeNull();
});
test('only lookahead controls next page; previous works and filters/product changes reset page1', async () => {
  service.listStockMovements.mockImplementation(async (_b, _p, params) =>
    page([row()], params?.page ?? 1, params?.page !== 2),
  );
  const view = await renderWithProviders(<StockMovementHistory productId="p" />);
  await waitFor(() => expect(screen.getByText('Página 1')).toBeTruthy());
  await press('Siguiente');
  await waitFor(() =>
    expect(service.listStockMovements).toHaveBeenLastCalledWith('b', 'p', {
      page: 2,
      pageSize: 25,
    }),
  );
  await waitFor(() => expect(screen.getByText('Página 2')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await press('Anterior');
  await waitFor(() => expect(screen.getByText('Página 1')).toBeTruthy());
  await press('Siguiente');
  await waitFor(() => expect(screen.getByText('Página 2')).toBeTruthy());
  const filters = {
    type: 'LOSS' as StockMovementType,
    from: '2026-01-01T00:00:00-03:00',
    to: '2026-02-01T00:00:00Z',
  };
  await view.rerender(<StockMovementHistory productId="p" filters={filters} />);
  await waitFor(() =>
    expect(service.listStockMovements).toHaveBeenLastCalledWith('b', 'p', {
      page: 1,
      pageSize: 25,
      ...filters,
    }),
  );
  await view.rerender(<StockMovementHistory productId="next-product" filters={filters} />);
  await waitFor(() =>
    expect(service.listStockMovements).toHaveBeenLastCalledWith('b', 'next-product', {
      page: 1,
      pageSize: 25,
      ...filters,
    }),
  );
});
test('safe read error hides previously successful rows and permits explicit retry', async () => {
  const client = createTestQueryClient();
  await renderWithProviders(<StockMovementHistory productId="p" />, { queryClient: client });
  await waitFor(() => expect(screen.getByText('Notas: Nota original')).toBeTruthy());
  service.listStockMovements.mockResolvedValue(failure);
  await act(async () => {
    await client.invalidateQueries({ queryKey: inventoryKeys.byBusiness('b') });
  });
  expect(screen.queryByText('Notas: Nota original')).toBeNull();
  expect(screen.getByText('Sin conexión.')).toBeTruthy();
  service.listStockMovements.mockResolvedValue(page());
  await press('Reintentar');
  await waitFor(() => expect(screen.getByText('Notas: Nota original')).toBeTruthy());
});
test('late business-A response cannot replace business-B data and page is reset', async () => {
  const pending = deferred<StockMovementHistoryResult>();
  service.listStockMovements.mockReturnValueOnce(pending.promise);
  const view = await renderWithProviders(<StockMovementHistory productId="p" />);
  businessMock.mockReturnValue(business('other'));
  service.listStockMovements.mockResolvedValue(
    page([row({ business_id: 'other', notes: 'Negocio B' })]),
  );
  await view.rerender(<StockMovementHistory productId="p" />);
  await waitFor(() => expect(screen.getByText('Notas: Negocio B')).toBeTruthy());
  await act(async () => pending.resolve(page([row({ notes: 'Negocio A tardío' })])));
  expect(screen.queryByText('Notas: Negocio A tardío')).toBeNull();
  expect(screen.getByText('Notas: Negocio B')).toBeTruthy();
  expect(service.listStockMovements).toHaveBeenLastCalledWith('other', 'p', {
    page: 1,
    pageSize: 25,
  });
});
test('late product-A response cannot replace current product-B history', async () => {
  const pending = deferred<StockMovementHistoryResult>();
  service.listStockMovements.mockReturnValueOnce(pending.promise);
  const view = await renderWithProviders(<StockMovementHistory productId="p" />);
  service.listStockMovements.mockResolvedValue(
    page([row({ product_id: 'next', notes: 'Producto B' })]),
  );
  await view.rerender(<StockMovementHistory productId="next" />);
  await waitFor(() => expect(screen.getByText('Notas: Producto B')).toBeTruthy());
  await act(async () => pending.resolve(page()));
  expect(screen.queryByText('Notas: Nota original')).toBeNull();
});
test.each([null, '', '   '])(
  'unavailable product %j is idle and never queries',
  async (productId) => {
    await renderWithProviders(<StockMovementHistory productId={productId} />);
    expect(screen.getByText('Selecciona un producto')).toBeTruthy();
    expect(service.listStockMovements).not.toHaveBeenCalled();
  },
);
test.each(['pending', 'idle'] as const)('business %s never queries history', async (status) => {
  businessMock.mockReturnValue(
    status === 'pending'
      ? { status: 'pending', data: null, error: null, isFetching: true }
      : { status: 'idle', data: null, error: null, isFetching: false },
  );
  await renderWithProviders(<StockMovementHistory productId="p" />);
  expect(service.listStockMovements).not.toHaveBeenCalled();
});
test('unavailable business error hides history and cannot issue a tenant read', async () => {
  businessMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'BUSINESS_ACCESS_DENIED', message: 'Negocio no disponible.' },
  });
  await renderWithProviders(<StockMovementHistory productId="p" />);
  expect(screen.getByText('Negocio no disponible.')).toBeTruthy();
  expect(service.listStockMovements).not.toHaveBeenCalled();
});
test('invalid filters produce controlled error without a read', async () => {
  await renderWithProviders(
    <StockMovementHistory productId="p" filters={{ from: '2026-01-01' }} />,
  );
  expect(
    screen.getByText('No se pudo cargar el historial de stock. Inténtalo nuevamente.'),
  ).toBeTruthy();
  expect(service.listStockMovements).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
});
test('hook uses complete keys, original IDs/instants and retry:false', async () => {
  businessMock.mockReturnValue(business(' Original B '));
  const filters = {
    type: 'SALE' as const,
    from: '2026-01-01T00:00:00.123456-03:00',
    to: '2026-02-01T00:00:00+05:30',
  };
  const view = await renderWithProviders(
    <Probe productId=" Original P " page={3} pageSize={10} filters={filters} />,
  );
  await waitFor(() => expect(latest.status).toBe('success'));
  expect(service.listStockMovements).toHaveBeenCalledWith(' Original B ', ' Original P ', {
    page: 3,
    pageSize: 10,
    ...filters,
  });
  const query = view.queryClient.getQueryCache().find({
    queryKey: inventoryKeys.stockMovements(' Original B ', ' Original P ', {
      page: 3,
      pageSize: 10,
      ...filters,
    }),
    exact: true,
  });
  expect(query?.options.retry).toBe(false);
  expect(view.queryClient.getMutationCache().getAll()).toHaveLength(0);
});
test('invalid paging is rejected locally rather than calling service', async () => {
  await renderWithProviders(<Probe page={0} />);
  expect(latest.status).toBe('error');
  expect(service.listStockMovements).not.toHaveBeenCalled();
});
