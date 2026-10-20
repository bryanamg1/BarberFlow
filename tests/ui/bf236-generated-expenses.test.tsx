import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ExpensesScreen } from '@/features/expenses/screens/ExpensesScreen';
import { expensesService } from '@/features/expenses/services/expensesService';
import { expenseCategoriesService } from '@/features/expenses/services/expenseCategoriesService';
import { purchasesService } from '@/features/purchases/services/purchasesService';
import type { PurchaseDetailData } from '@/features/purchases/types/purchaseRead.types';
import { routerMock } from '@/test/routerTestUtils';
import {
  expenseCategory,
  expenseContext,
  expenseDeferred,
  expenseRow,
  mountExpense,
} from './helpers/expenseFixtures';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/expenses/services/expensesService', () => ({
  expensesService: {
    listByBusiness: jest.fn(),
    createManual: jest.fn(),
    updateManual: jest.fn(),
  },
}));
jest.mock('@/features/expenses/services/expenseCategoriesService', () => ({
  expenseCategoriesService: {
    listByBusiness: jest.fn(),
    getById: jest.fn(),
  },
}));
jest.mock('@/features/purchases/services/purchasesService', () => ({
  purchasesService: {
    getById: jest.fn(),
    voidPurchase: jest.fn(),
    completePurchase: jest.fn(),
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
const pid = '00000000-0000-4000-8000-000000000236';
const generated = () => ({
  ...expenseRow('generated-hidden-id'),
  description: 'Compra registrada',
  source_type: 'PURCHASE' as const,
  purchase_id: pid,
});
const detail = (status: 'COMPLETED' | 'VOIDED' = 'COMPLETED'): PurchaseDetailData => ({
  purchase: {
    id: pid,
    supplier: 'Proveedor histórico',
    total: 1500.5,
    purchased_at: '2026-09-20T12:00:00Z',
    status,
    notes: null,
  },
  items: [],
  expense: {
    amount: 1500.5,
    expense_date: '2026-09-20',
    payment_method: 'CASH',
    category_name: 'Categoría histórica',
  },
  voidInfo: { status: status === 'VOIDED' ? 'unavailable' : 'not_applicable' },
});
const service = jest.mocked(expensesService),
  purchases = jest.mocked(purchasesService);
const press = (name: string | RegExp) => userEvent.press(screen.getByRole('button', { name }));
async function list() {
  const view = await mountExpense(<ExpensesScreen />);
  await screen.findByText('Compra registrada');
  return view;
}
const expand = () => press(/Ver información de compra:/);
beforeEach(() => {
  jest.clearAllMocks();
  expenseContext();
  mockFocused = true;
  notifyManager.setScheduler(queueMicrotask);
  service.listByBusiness.mockImplementation(async (_b, params) => ({
    data: {
      items: [expenseRow(), generated()].filter(
        (r) => !params?.sourceType || r.source_type === params.sourceType,
      ),
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 25,
      hasNextPage: (params?.page ?? 1) === 1,
    },
    error: null,
  }));
  jest.mocked(expenseCategoriesService).listByBusiness.mockResolvedValue({
    data: { items: [expenseCategory()], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  purchases.getById.mockResolvedValue({ data: detail(), error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

it('keeps MANUAL edit behavior and PURCHASE historical/read-only without eager parent reads', async () => {
  await list();
  expect(screen.getByText('Registro histórico generado por una compra.')).toBeTruthy();
  expect(screen.getByText('Solo lectura')).toBeTruthy();
  expect(purchases.getById).not.toHaveBeenCalled();
  const edits = screen.getAllByRole('button', { name: /^Editar gasto:/ });
  expect(edits).toHaveLength(1);
  await userEvent.press(edits[0]);
  expect(routerMock.push).toHaveBeenCalledWith('/expenses/expense-hidden-id/edit');
  expect(screen.queryByRole('button', { name: /Anular|Eliminar|Adjuntar/ })).toBeNull();
});
it('authorized relationship displays historical category and links to existing purchase route', async () => {
  await list();
  await expand();
  await screen.findByText('Categoría: Categoría histórica');
  expect(purchases.getById).toHaveBeenCalledWith('b', pid);
  await press('Abrir compra de origen');
  expect(routerMock.push).toHaveBeenCalledWith(`/purchases/${pid}`);
  expect(screen.queryByText(/generated-hidden-id|00000000|category-hidden-id/)).toBeNull();
});
it('VOIDED preserves expense and states original-period non-effective context without refund language', async () => {
  purchases.getById.mockResolvedValue({ data: detail('VOIDED'), error: null });
  await list();
  await expand();
  await screen.findByText('Compra anulada');
  expect(screen.getByText('Compra registrada')).toBeTruthy();
  expect(screen.getByText(/No cuenta como gasto efectivo en su período original/)).toBeTruthy();
  expect(screen.queryByText(/refund|reembolso|dinero devuelto|devolución automática/i)).toBeNull();
  expect(service.createManual).not.toHaveBeenCalled();
  expect(service.updateManual).not.toHaveBeenCalled();
  expect(purchases.voidPurchase).not.toHaveBeenCalled();
  expect(purchases.completePurchase).not.toHaveBeenCalled();
});
it('COMPLETED adds no invented status', async () => {
  await list();
  await expand();
  await screen.findByRole('button', { name: 'Abrir compra de origen' });
  expect(screen.queryByText('Compra anulada')).toBeNull();
  expect(screen.queryByText(/No cuenta como gasto efectivo/)).toBeNull();
});
it.each(['NOT_FOUND', 'ACCESS_DENIED', 'NETWORK_ERROR'] as const)(
  'parent %s gives neutral state, no link or raw error',
  async (code) => {
    purchases.getById.mockResolvedValueOnce({
      data: null,
      error: { code, message: 'sensitive SQL or identifier' },
    });
    await list();
    await expand();
    await screen.findByText('Información de compra no disponible.');
    expect(screen.queryByRole('button', { name: 'Abrir compra de origen' })).toBeNull();
    expect(screen.queryByText(/sensitive/)).toBeNull();
    expect(screen.getByText('Compra registrada')).toBeTruthy();
    await press('Reintentar información de compra');
    await screen.findByRole('button', { name: 'Abrir compra de origen' });
  },
);
it('missing parent identifier is unavailable without a new read boundary', async () => {
  service.listByBusiness.mockResolvedValue({
    data: {
      items: [{ ...generated(), purchase_id: null }],
      page: 1,
      pageSize: 25,
      hasNextPage: false,
    },
    error: null,
  });
  await list();
  await expand();
  await screen.findByText('Información de compra no disponible.');
  expect(purchases.getById).not.toHaveBeenCalled();
});
it('source filters and pagination preserve server parameters', async () => {
  await list();
  await press('Compras');
  await waitFor(() => expect(screen.queryByText('Alquiler del local')).toBeNull());
  await press('Siguiente');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith(
      'b',
      expect.objectContaining({ sourceType: 'PURCHASE', page: 2, pageSize: 25 }),
    ),
  );
  await press('Todos los orígenes');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith(
      'b',
      expect.objectContaining({ sourceType: undefined, page: 1 }),
    ),
  );
});
it.each(['business', 'user', 'membership', 'logout', 'focus', 'unmount'])(
  'late parent result cannot expose old relationship after %s change',
  async (change) => {
    const deferred = expenseDeferred<Awaited<ReturnType<typeof purchasesService.getById>>>();
    purchases.getById.mockReturnValue(deferred.promise);
    const view = await list();
    await expand();
    if (change === 'business') expenseContext('other');
    if (change === 'user') expenseContext('b', 'other-user');
    if (change === 'membership') expenseContext('b', 'u', 'other-member');
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (change === 'focus') mockFocused = false;
    if (change === 'unmount') await view.unmount();
    else await view.rerender(<ExpensesScreen />);
    await act(async () => deferred.resolve({ data: detail('VOIDED'), error: null }));
    expect(screen.queryByRole('button', { name: 'Abrir compra de origen' })).toBeNull();
    expect(screen.queryByText('Compra anulada')).toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
  },
);
