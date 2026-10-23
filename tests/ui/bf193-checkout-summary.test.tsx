import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import { productsService } from '@/features/products/services/productsService';
import type { ProductRow } from '@/features/products/types/product.types';
import { CheckoutProductItems } from '@/features/sales/components/CheckoutProductItems';
import { CheckoutServiceItems } from '@/features/sales/components/CheckoutServiceItems';
import { CheckoutSummary } from '@/features/sales/components/CheckoutSummary';
import { checkoutDraftStore } from '@/features/sales/store/checkoutDraftStore';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { servicesService } from '@/features/services/services/servicesService';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatMoney } from '@/utils/formatMoney';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { list: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { listByBusiness: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK or writes in checkout summary');
});
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const state = () => checkoutDraftStore.getState();
const money = (value: string) => formatMoney(value, 'ARS');
let service: ServiceRow, product: ProductRow, balance: string;
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
  service = {
    id: 's',
    business_id: 'b',
    name: 'Corte',
    price: 0.29,
    duration_minutes: 30,
    description: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
  product = {
    id: 'p',
    business_id: 'b',
    name: 'Shampoo',
    sale_price: 0.31,
    default_purchase_cost: 0.1,
    minimum_stock: 0,
    category_id: null,
    description: null,
    sku: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
  balance = '10';
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
  jest
    .mocked(servicesService.getById)
    .mockImplementation(async () => ({ data: service, error: null }));
  jest.mocked(servicesService.list).mockImplementation(async () => ({
    data: { items: [service], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  }));
  jest
    .mocked(productsService.getById)
    .mockImplementation(async () => ({ data: product, error: null }));
  jest.mocked(productsService.listByBusiness).mockImplementation(async () => ({
    data: { items: [product], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  }));
  jest.mocked(inventoryService.getProductStock).mockImplementation(async (_business, ids) => ({
    data: ids.map((product_id) => ({ product_id, current_stock: balance })),
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
function mixed() {
  state().addLine(
    scope,
    'op',
    { lineId: 's1', itemType: 'SERVICE', itemId: 's', quantity: 1 },
    'b',
  );
  state().addLine(
    scope,
    'op',
    { lineId: 'p1', itemType: 'PRODUCT', itemId: 'p', quantity: 1 },
    'b',
  );
}
async function setup(editors = false) {
  const eligibility = jest.fn();
  const view = await renderWithProviders(
    <>
      {editors && (
        <>
          <CheckoutServiceItems />
          <CheckoutProductItems />
        </>
      )}
      <CheckoutSummary onEligibilityChange={eligibility} />
    </>,
  );
  return { ...view, eligibility };
}
async function ready() {
  await screen.findByText('Resumen listo para revisión');
}

test('empty draft is visible with genuine zero, ineligible and no payment/submit surface', async () => {
  const { eligibility } = await setup();
  expect(screen.getByText('Agrega al menos una línea al checkout')).toBeTruthy();
  expect(screen.getByText(`Subtotal estimado: ${money('0.00')}`)).toBeTruthy();
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
test('mixed independent duplicate lines, quantities and overrides yield exact cents', async () => {
  mixed();
  state().addLine(
    scope,
    'op',
    { lineId: 's2', itemType: 'SERVICE', itemId: 's', quantity: 2 },
    'b',
  );
  state().addLine(
    scope,
    'op',
    {
      lineId: 'p2',
      itemType: 'PRODUCT',
      itemId: 'p',
      quantity: 3,
      unitPriceOverride: '0.20',
    },
    'b',
  );
  const { eligibility } = await setup();
  await ready();
  expect(screen.getAllByText(/^[1-4]\. (Servicio|Producto):/)).toHaveLength(4);
  expect(screen.getByText(`Subtotal estimado: ${money('1.78')}`)).toBeTruthy();
  expect(screen.getByText(`Total estimado: ${money('1.78')}`)).toBeTruthy();
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: true });
  expect(state().draft?.paymentMethod).toBeUndefined();
  expect(servicesService.getById).toHaveBeenCalledTimes(1);
  expect(productsService.getById).toHaveBeenCalledTimes(1);
});
test('discount survives item removal, invalidates total and can explicitly be replaced', async () => {
  mixed();
  state().patchDraft(scope, 'op', { discountAmount: '0.50' });
  const { eligibility } = await setup();
  await ready();
  expect(screen.getByText(`Total estimado: ${money('0.10')}`)).toBeTruthy();
  await act(() => {
    state().removeLine(scope, 'op', 'p1');
  });
  expect(screen.getByText(/El descuento supera el subtotal/)).toBeTruthy();
  expect(screen.getByText('Total estimado: No disponible')).toBeTruthy();
  expect(state().draft?.discountAmount).toBe('0.50');
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  await act(() => {
    state().patchDraft(scope, 'op', { discountAmount: '0.29' });
  });
  await ready();
  expect(screen.getByText(`Total estimado: ${money('0.00')}`)).toBeTruthy();
  expect(state().draft?.discountAmount).toBe('0.29');
});
test.each([
  ['Cantidad de línea 1', '1.5'],
  ['Precio unitario opcional de línea 1', '-1.00'],
  ['Cantidad de producto de línea 1', '0'],
  ['Precio unitario opcional de producto de línea 1', 'abc'],
])('editor invalid text %s invalidates an independently mounted summary', async (label, text) => {
  mixed();
  const { eligibility } = await setup(true);
  await ready();
  await fireEvent.changeText(screen.getByLabelText(label), text);
  expect(screen.getByLabelText(label)).toHaveDisplayValue(text);
  expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
  expect(screen.getByText('Total estimado: No disponible')).toBeTruthy();
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  expect(state().captureIntent(scope, 'op')).toBeNull();
});
test('duplicate product demand is aggregated without merging summary lines', async () => {
  mixed();
  balance = '2';
  state().addLine(
    scope,
    'op',
    { lineId: 'p2', itemType: 'PRODUCT', itemId: 'p', quantity: 2 },
    'b',
  );
  const { eligibility } = await setup();
  await screen.findAllByText('Stock insuficiente · demanda total 3');
  expect(screen.getAllByText(/^[1-3]\. (Servicio|Producto):/)).toHaveLength(3);
  expect(screen.getByText(`Subtotal estimado: ${money('1.22')}`)).toBeTruthy();
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
});
test('catalog refresh updates estimates while retaining explicit override and discount', async () => {
  mixed();
  state().updateLine(scope, 'op', 'p1', { unitPriceOverride: '0.20' });
  state().patchDraft(scope, 'op', { discountAmount: '0.10' });
  const { queryClient } = await setup();
  await ready();
  service = { ...service, price: 0.5 };
  product = { ...product, sale_price: 99 };
  await act(async () => {
    await queryClient.invalidateQueries();
  });
  await ready();
  expect(screen.getByText(`Subtotal estimado: ${money('0.70')}`)).toBeTruthy();
  expect(screen.getByText(`Total estimado: ${money('0.60')}`)).toBeTruthy();
  expect(state().draft?.items[1].unitPriceOverride).toBe('0.20');
});
test.each(['SERVICE', 'PRODUCT'])(
  'archived %s reference remains visible without fake subtotal',
  async (kind) => {
    mixed();
    const { queryClient, eligibility } = await setup();
    await ready();
    if (kind === 'SERVICE') service = { ...service, is_active: false };
    else product = { ...product, is_active: false };
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await screen.findByText('Referencia no disponible; la línea se conserva.');
    expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
    expect(state().draft?.items).toHaveLength(2);
    expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  },
);
test('catalog pending/error remain distinct from numeric zero', async () => {
  mixed();
  let resolve!: (value: Awaited<ReturnType<typeof servicesService.getById>>) => void;
  jest.mocked(servicesService.getById).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { eligibility } = await setup();
  expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
  await act(async () => {
    resolve({ data: null, error: { code: 'NETWORK_ERROR', message: 'Sin conexión' } });
  });
  await screen.findByText('No se pudo resolver el catálogo o stock del resumen.');
  expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
});
test.each(['loading', 'error', 'absent'])(
  'stock %s never becomes sufficient or a fake zero balance',
  async (mode) => {
    mixed();
    if (mode === 'loading')
      jest.mocked(inventoryService.getProductStock).mockImplementation(() => new Promise(() => {}));
    if (mode === 'error')
      jest.mocked(inventoryService.getProductStock).mockResolvedValue({
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
      });
    if (mode === 'absent')
      jest.mocked(inventoryService.getProductStock).mockResolvedValue({ data: [], error: null });
    const { eligibility } = await setup();
    await screen.findByText(
      mode === 'loading' ? 'Stock pendiente de consulta' : 'Stock no disponible',
    );
    await screen.findByText(`Subtotal estimado: ${money('0.60')}`);
    expect(screen.queryByText('Resumen listo para revisión')).toBeNull();
    expect(screen.queryByText(/Stock suficiente/)).toBeNull();
    expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
    expect(state().draft?.items).toHaveLength(2);
  },
);
test.each(['user', 'business', 'membership', 'logout'])(
  'context %s hides old draft and reports no usable operation',
  async (change) => {
    mixed();
    const { rerender, eligibility } = await setup();
    await ready();
    if (change === 'user') context('other');
    if (change === 'business') context('u', 'other');
    if (change === 'membership') context('u', 'b', 'other');
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    await rerender(<CheckoutSummary onEligibilityChange={eligibility} />);
    expect(screen.getByText('Sin checkout activo')).toBeTruthy();
    expect(screen.queryByText('Resumen listo para revisión')).toBeNull();
    expect(eligibility.mock.calls.at(-1)?.[0]).toMatchObject({
      operationId: null,
      eligible: false,
    });
  },
);
test('captured pending intent blocks summary without changing its exact estimates', async () => {
  mixed();
  const { eligibility } = await setup();
  await ready();
  await act(() => {
    state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
    state().captureIntent(scope, 'op');
  });
  await waitFor(() =>
    expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false }),
  );
  expect(
    screen.getByText('La intención está bloqueada mientras se resuelve el checkout.'),
  ).toBeTruthy();
  expect(screen.getByText(`Total estimado: ${money('0.60')}`)).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
