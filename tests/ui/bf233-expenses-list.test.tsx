import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { expensesService } from '@/features/expenses/services/expensesService';
import { expenseCategoriesService } from '@/features/expenses/services/expenseCategoriesService';
import { ExpensesScreen } from '@/features/expenses/screens/ExpensesScreen';
import type { ExpenseListPage, ExpenseResult } from '@/features/expenses/types/expense.types';
import { expenseError } from '@/features/expenses/utils/expenseErrors';
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
jest.mock('@/features/purchases/services/purchasesService', () => ({
  purchasesService: { getById: jest.fn() },
}));
jest.mock('@/features/expenses/services/expensesService', () => ({
  expensesService: {
    listByBusiness: jest.fn(),
    getById: jest.fn(),
    createManual: jest.fn(),
    updateManual: jest.fn(),
  },
}));
jest.mock('@/features/expenses/services/expenseCategoriesService', () => ({
  expenseCategoriesService: { listByBusiness: jest.fn(), getById: jest.fn() },
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
const service = jest.mocked(expensesService);
const categories = jest.mocked(expenseCategoriesService);
const press = (name: string | RegExp) => userEvent.press(screen.getByRole('button', { name }));
beforeEach(() => {
  jest.clearAllMocks();
  expenseContext();
  mockFocused = true;
  notifyManager.setScheduler(queueMicrotask);
  service.listByBusiness.mockResolvedValue({
    data: {
      items: [
        expenseRow(),
        {
          ...expenseRow('purchase-expense-hidden'),
          source_type: 'PURCHASE',
          purchase_id: 'parent-hidden',
          description: 'Compra registrada',
        },
      ],
      page: 1,
      pageSize: 25,
      hasNextPage: false,
    },
    error: null,
  });
  categories.listByBusiness.mockResolvedValue({
    data: { items: [expenseCategory()], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  categories.getById.mockResolvedValue({ data: expenseCategory(), error: null });
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

test('populated list uses real hooks, readable fields and only approved new/manual edit destinations', async () => {
  await mountExpense(<ExpensesScreen />);
  await waitFor(() => expect(screen.getByText('Alquiler del local')).toBeTruthy());
  expect(screen.getByText('Compra registrada')).toBeTruthy();
  expect(screen.getByText('Solo lectura')).toBeTruthy();
  expect(screen.getByText('Manual')).toBeTruthy();
  expect(screen.getByText('Compra')).toBeTruthy();
  expect(screen.getAllByText(/2026-09-20 · Efectivo/)).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /Editar gasto:/ })).toHaveLength(1);
  expect(screen.queryByText(/expense-hidden|category-hidden|parent-hidden/)).toBeNull();
  await press('Nuevo gasto');
  expect(routerMock.push).toHaveBeenLastCalledWith('/expenses/new');
  await press(/Editar gasto:/);
  expect(routerMock.push).toHaveBeenLastCalledWith('/expenses/expense-hidden-id/edit');
  expect(service.createManual).not.toHaveBeenCalled();
  expect(service.updateManual).not.toHaveBeenCalled();
  expect(categories.getById).not.toHaveBeenCalled(); // no category lookup per expense row
});
test('loading remains usable and empty is explicit with new action', async () => {
  const d = expenseDeferred<ExpenseResult<ExpenseListPage>>();
  service.listByBusiness.mockReturnValue(d.promise);
  await mountExpense(<ExpensesScreen />);
  expect(screen.getByText('Cargando gastos…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Nuevo gasto' })).toBeEnabled();
  await act(async () =>
    d.resolve({ data: { items: [], page: 1, pageSize: 25, hasNextPage: false }, error: null }),
  );
  await waitFor(() => expect(screen.getByText('No hay gastos para estos filtros')).toBeTruthy());
});
test('safe error exposes retry which refetches without a write', async () => {
  service.listByBusiness.mockResolvedValueOnce({
    data: null,
    error: expenseError('NETWORK_ERROR'),
  });
  await mountExpense(<ExpensesScreen />);
  await waitFor(() => expect(screen.getByText(/No se pudo conectar con los gastos/)).toBeTruthy());
  await press('Reintentar');
  await waitFor(() => expect(screen.getByText('Alquiler del local')).toBeTruthy());
  expect(service.listByBusiness).toHaveBeenCalledTimes(2);
});
test('explicit paging and every source/date/category filter reset page and preserve civil range', async () => {
  service.listByBusiness.mockImplementation(async (_b, p = {}) => ({
    data: { items: [expenseRow()], page: p.page ?? 1, pageSize: 25, hasNextPage: true },
    error: null,
  }));
  await mountExpense(<ExpensesScreen />);
  await waitFor(() => expect(screen.getByText('Página 1')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await press('Siguiente');
  await waitFor(() => expect(screen.getByText('Página 2')).toBeTruthy());
  await press('Compras');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      sourceType: 'PURCHASE',
    }),
  );
  await fireEvent.changeText(screen.getByLabelText('Desde (YYYY-MM-DD)'), '2026-09-01');
  await fireEvent.changeText(
    screen.getByLabelText('Hasta, sin incluir (YYYY-MM-DD)'),
    '2026-10-01',
  );
  await press('Aplicar fechas');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith(
      'b',
      expect.objectContaining({ from: '2026-09-01', to: '2026-10-01', page: 1 }),
    ),
  );
  await press('Elegir categoría');
  await press('Seleccionar categoría: Alquiler');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith(
      'b',
      expect.objectContaining({ categoryId: 'category-hidden-id', page: 1 }),
    ),
  );
  await press('Elegir categoría');
  await press('Todas las categorías');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      sourceType: 'PURCHASE',
      from: '2026-09-01',
      to: '2026-10-01',
    }),
  );
});
test('invalid civil dates/order keep the existing applied filters and display accessible error', async () => {
  await mountExpense(<ExpensesScreen />);
  await waitFor(() => expect(screen.getByText('Alquiler del local')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Desde (YYYY-MM-DD)'), '2026-02-30');
  await press('Aplicar fechas');
  expect(screen.getByText('Revisa las fechas y su orden.')).toHaveProp('role', 'alert');
  expect(service.listByBusiness).toHaveBeenCalledTimes(1);
});
test('category filter supports archived choices and bounded paging without showing IDs', async () => {
  categories.listByBusiness.mockImplementation(async (_b, p = {}) => ({
    data: {
      items: [expenseCategory(p.page === 2 ? 'old' : 'category-hidden-id', p.page !== 2)],
      page: p.page ?? 1,
      pageSize: 25,
      hasNextPage: p.page !== 2,
    },
    error: null,
  }));
  await mountExpense(<ExpensesScreen />);
  await press('Elegir categoría');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Más categorías' })).toBeEnabled());
  await press('Más categorías');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Seleccionar categoría: Categoría histórica, archivada' }),
    ).toBeTruthy(),
  );
  await press('Seleccionar categoría: Categoría histórica, archivada');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith(
      'b',
      expect.objectContaining({ categoryId: 'old' }),
    ),
  );
});
test.each(['BARBER', 'logout', 'recovery', 'blur', 'businessPending'] as const)(
  'context %s hides rows/actions and cannot start expenses requests',
  async (state) => {
    if (state === 'BARBER') expenseContext('b', 'u', 'm', 'BARBER');
    if (state === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (state === 'recovery') {
      const auth = useAuth();
      if (auth.status === 'authenticated')
        jest.mocked(useAuth).mockReturnValue({ ...auth, status: 'recovering' });
    }
    if (state === 'blur') mockFocused = false;
    if (state === 'businessPending')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
    await mountExpense(<ExpensesScreen />);
    expect(screen.queryByRole('button', { name: 'Nuevo gasto' })).toBeNull();
    expect(service.listByBusiness).not.toHaveBeenCalled();
  },
);
test('business/user changes remount filters and stale results never display previous tenant values', async () => {
  const d = expenseDeferred<ExpenseResult<ExpenseListPage>>();
  service.listByBusiness.mockReturnValueOnce(d.promise);
  const view = await mountExpense(<ExpensesScreen />);
  expenseContext('other', 'other-user', 'other-member');
  service.listByBusiness.mockResolvedValue({
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  await view.rerender(<ExpensesScreen />);
  await waitFor(() => expect(screen.getByText('No hay gastos para estos filtros')).toBeTruthy());
  await act(async () =>
    d.resolve({
      data: { items: [expenseRow()], page: 1, pageSize: 25, hasNextPage: false },
      error: null,
    }),
  );
  expect(screen.queryByText('Alquiler del local')).toBeNull();
  expect(screen.getByLabelText('Desde (YYYY-MM-DD)')).toHaveProp('value', '');
});
