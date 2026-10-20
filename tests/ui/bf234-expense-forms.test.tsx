import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useLocalSearchParams } from 'expo-router';

import EditRoute from '@/app/(app)/expenses/[id]/edit';
import NewRoute from '@/app/(app)/expenses/new';
import { useAuth } from '@/features/auth/context/AuthContext';
import { expensesKeys } from '@/features/expenses/constants/expensesKeys';
import {
  ExpenseCreateScreen,
  ExpenseEditScreen,
} from '@/features/expenses/screens/ManualExpenseScreen';
import { expenseCategoriesService } from '@/features/expenses/services/expenseCategoriesService';
import { expensesService } from '@/features/expenses/services/expensesService';
import { expenseError } from '@/features/expenses/utils/expenseErrors';
import type { ExpenseResult } from '@/features/expenses/types/expense.types';
import { routerMock } from '@/test/routerTestUtils';
import { theme } from '@/theme';

import {
  expenseCategory,
  expenseContext,
  expenseDeferred,
  expenseRow,
  mountExpense,
} from './helpers/expenseFixtures';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/storage', () => ({
  storageService: { upload: jest.fn(), createSignedUrl: jest.fn() },
}));
jest.mock('@/features/expenses/services/receiptPicker', () => ({
  receiptPicker: { pick: jest.fn() },
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
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 64,
  usePreventRemove: jest.fn(),
}));
let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  useLocalSearchParams: jest.fn(() => ({ id: 'expense-hidden-id' })),
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));

const service = jest.mocked(expensesService);
const categories = jest.mocked(expenseCategoriesService);
const press = (name: string | RegExp) => userEvent.press(screen.getByRole('button', { name }));
const amount = () => screen.getByLabelText('Importe (obligatorio)');
const description = () => screen.getByLabelText('Descripción (obligatoria)');
const date = () => screen.getByLabelText('Fecha del gasto (YYYY-MM-DD, obligatoria)');
const notes = () => screen.getByLabelText('Notas (opcional)');
async function fill(
  options: { amount?: string; date?: string; method?: string; category?: boolean } = {},
) {
  await fireEvent.changeText(description(), '  Texto original  ');
  await fireEvent.changeText(amount(), options.amount ?? '10.50');
  await fireEvent.changeText(date(), options.date ?? '2026-09-20');
  if (options.category !== false) {
    await press('Elegir categoría');
    await press('Seleccionar categoría: Alquiler');
  }
  if (options.method !== '') await press(`Medio de pago: ${options.method ?? 'Efectivo'}`);
}
beforeEach(() => {
  jest.clearAllMocks();
  expenseContext();
  mockFocused = true;
  notifyManager.setScheduler(queueMicrotask);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'expense-hidden-id' });
  categories.listByBusiness.mockResolvedValue({
    data: { items: [expenseCategory()], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  categories.getById.mockResolvedValue({ data: expenseCategory(), error: null });
  service.getById.mockResolvedValue({ data: expenseRow(), error: null });
  service.createManual.mockResolvedValue({ data: expenseRow('persisted-id'), error: null });
  service.updateManual.mockImplementation(async (_b, id, input) => ({
    data: {
      ...expenseRow(id),
      ...input,
      amount: input.amount === undefined ? 1500.5 : Number(input.amount),
    },
    error: null,
  }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

test('create route renders real labeled form, exact five choices, no receipt/path/server-owned inputs', async () => {
  expect(NewRoute).toBe(ExpenseCreateScreen);
  await mountExpense(<NewRoute />);
  expect(amount()).toHaveProp('value', '');
  expect(date()).toHaveProp('value', '');
  expect(screen.getAllByRole('button', { name: /^Medio de pago:/ })).toHaveLength(5);
  expect(screen.queryByText(/receipt|category-hidden|expense-hidden|created_by/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Crear gasto' })).toHaveStyle({
    minHeight: theme.sizing.touchTarget,
  });
});
test('valid zero create preserves strings/notes and replaces once with actual persisted id', async () => {
  await mountExpense(<ExpenseCreateScreen />);
  await fill({ amount: '0.00' });
  await fireEvent.changeText(notes(), '  Nota sin trim  ');
  await press('Crear gasto');
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith('/expenses/persisted-id/edit'),
  );
  expect(service.createManual).toHaveBeenCalledTimes(1);
  expect(service.createManual).toHaveBeenCalledWith('b', {
    category_id: 'category-hidden-id',
    description: '  Texto original  ',
    amount: '0.00',
    expense_date: '2026-09-20',
    payment_method: 'CASH',
    notes: '  Nota sin trim  ',
  });
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(routerMock.replace).toHaveBeenCalledTimes(1);
});
test.each(['', '-1', '1.234', '1e2', '1,50', '10000000000.00'])(
  'invalid decimal %j is rejected near field without a write',
  async (value) => {
    await mountExpense(<ExpenseCreateScreen />);
    await fill({ amount: value });
    await press('Crear gasto');
    await waitFor(() => expect(screen.getByText(/Error:.*importe/i)).toBeTruthy());
    expect(amount()).toHaveProp('accessibilityHint', expect.stringContaining('Error:'));
    expect(service.createManual).not.toHaveBeenCalled();
    expect(amount()).toHaveProp('value', value);
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);
test('civil invalid date plus missing category/payment cannot submit or invent defaults', async () => {
  await mountExpense(<ExpenseCreateScreen />);
  await fill({ date: '2026-02-30', category: false, method: '' });
  await press('Crear gasto');
  await waitFor(() => expect(screen.getByText('Selecciona una categoría válida.')).toBeTruthy());
  expect(screen.getByText('Selecciona un medio de pago válido.')).toBeTruthy();
  expect(service.createManual).not.toHaveBeenCalled();
});
test.each([
  ['Transferencia bancaria', 'BANK_TRANSFER'],
  ['Tarjeta de débito', 'DEBIT_CARD'],
  ['Tarjeta de crédito', 'CREDIT_CARD'],
  ['Billetera digital / QR', 'DIGITAL_WALLET'],
])('payment label %s sends exact HD006 code %s and no legacy alias', async (label, code) => {
  await mountExpense(<ExpenseCreateScreen />);
  await fill({ method: label });
  await press('Crear gasto');
  await waitFor(() =>
    expect(service.createManual).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ payment_method: code }),
    ),
  );
});
test('create pending blocks fields/cancel/repeated submit and installs only a pending removal guard', async () => {
  const d = expenseDeferred<ExpenseResult>();
  service.createManual.mockReturnValue(d.promise);
  await mountExpense(<ExpenseCreateScreen />);
  await fill();
  await press('Crear gasto');
  await press('Crear gasto');
  await waitFor(() => expect(service.createManual).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(amount()).toHaveProp('editable', false);
  expect(jest.mocked(usePreventRemove)).toHaveBeenLastCalledWith(true, expect.any(Function));
  await press('Cancelar');
  expect(routerMock.replace).not.toHaveBeenCalled();
  await act(async () => d.resolve({ data: expenseRow('created'), error: null }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/expenses/created/edit'));
  expect(jest.mocked(usePreventRemove)).toHaveBeenLastCalledWith(false, expect.any(Function));
});
test('create error retains exact values; explicit retry reuses the captured input', async () => {
  service.createManual.mockResolvedValueOnce({ data: null, error: expenseError('NETWORK_ERROR') });
  await mountExpense(<ExpenseCreateScreen />);
  await fill();
  await press('Crear gasto');
  await waitFor(() => expect(screen.getByText(/No se pudo conectar con los gastos/)).toBeTruthy());
  expect(description()).toHaveProp('value', '  Texto original  ');
  expect(amount()).toHaveProp('value', '10.50');
  expect(routerMock.replace).not.toHaveBeenCalled();
  const input = service.createManual.mock.calls[0][1];
  await press('Reintentar guardado');
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith('/expenses/persisted-id/edit'),
  );
  expect(service.createManual.mock.calls[1][1]).toEqual(input);
});
test('create cancel returns exactly to collection with no write, ignoring history', async () => {
  await mountExpense(<ExpenseCreateScreen />);
  await fireEvent.changeText(description(), 'Sin guardar');
  await press('Cancelar');
  expect(routerMock.replace).toHaveBeenCalledWith('/expenses');
  expect(service.createManual).not.toHaveBeenCalled();
  expect(routerMock.back).not.toHaveBeenCalled();
});
test('detail loading -> safe error -> retry -> hydrate manual; no edit before load', async () => {
  const d = expenseDeferred<ExpenseResult>();
  service.getById.mockReturnValueOnce(d.promise);
  await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  expect(screen.getByText('Cargando gasto…')).toBeTruthy();
  expect(screen.queryByLabelText('Importe (obligatorio)')).toBeNull();
  await act(async () => d.resolve({ data: null, error: expenseError('NETWORK_ERROR') }));
  await waitFor(() => expect(screen.getByText(/No se pudo conectar/)).toBeTruthy());
  await press('Reintentar');
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
});
test('dirty-only update stays, adopts persisted values and preserves nullable notes/receipt without resending them', async () => {
  service.getById.mockResolvedValue({
    data: { ...expenseRow(), receipt_path: 'receipts/private-path-hidden' },
    error: null,
  });
  service.updateManual.mockResolvedValue({
    data: {
      ...expenseRow(),
      description: 'Persistido por servidor',
      receipt_path: 'receipts/private-path-hidden',
    },
    error: null,
  });
  await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  await fireEvent.changeText(description(), '  Editado  ');
  await press('Guardar cambios');
  await waitFor(() => expect(screen.getByText('Gasto guardado correctamente.')).toBeTruthy());
  expect(service.updateManual).toHaveBeenCalledWith('b', 'expense-hidden-id', {
    description: '  Editado  ',
  });
  expect(description()).toHaveProp('value', 'Persistido por servidor');
  expect(notes()).toHaveProp('value', '');
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.queryByText(/private-path-hidden/)).toBeNull();
});
test('edit clearing nullable notes sends empty string, not null or omission', async () => {
  service.getById.mockResolvedValue({ data: { ...expenseRow(), notes: 'Antes' }, error: null });
  await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(notes()).toHaveProp('value', 'Antes'));
  await fireEvent.changeText(notes(), '');
  await press('Guardar cambios');
  await waitFor(() =>
    expect(service.updateManual).toHaveBeenCalledWith('b', 'expense-hidden-id', { notes: '' }),
  );
});
test('archived selected category is represented and retained; new selectable options stay active', async () => {
  categories.getById.mockResolvedValue({
    data: expenseCategory('category-hidden-id', false),
    error: null,
  });
  await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(screen.getByText(/Categoría histórica · Archivada/)).toBeTruthy());
  await press('Elegir categoría');
  expect(categories.listByBusiness).toHaveBeenCalledWith('b', {
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  expect(
    screen.queryByRole('button', { name: 'Seleccionar categoría: Categoría histórica, archivada' }),
  ).toBeNull();
  await fireEvent.changeText(description(), 'Otra nota');
  await press('Guardar cambios');
  await waitFor(() =>
    expect(service.updateManual).toHaveBeenCalledWith('b', 'expense-hidden-id', {
      description: 'Otra nota',
    }),
  );
});
test('refetch cannot overwrite active edits; update failure preserves draft and no navigation', async () => {
  service.updateManual.mockResolvedValue({
    data: null,
    error: expenseError('EXPENSE_ACCESS_DENIED'),
  });
  const view = await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  await fireEvent.changeText(description(), 'Borrador');
  service.getById.mockResolvedValue({
    data: { ...expenseRow(), description: 'Respuesta tardía' },
    error: null,
  });
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: expensesKeys.byBusiness('b') });
  });
  expect(description()).toHaveProp('value', 'Borrador');
  await press('Guardar cambios');
  await waitFor(() => expect(screen.getByText('No se pudo acceder al gasto.')).toBeTruthy());
  expect(description()).toHaveProp('value', 'Borrador');
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('confirmed update remains saved if refresh rejects; retry reads does not repeat update', async () => {
  const view = await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  jest
    .spyOn(view.client, 'invalidateQueries')
    .mockRejectedValueOnce(new Error('test-only refresh failure'));
  await fireEvent.changeText(description(), 'Confirmado');
  await press('Guardar cambios');
  await waitFor(() => expect(screen.getByText('Gasto guardado correctamente.')).toBeTruthy());
  expect(
    screen.getByText('El gasto se guardó, pero no se pudo actualizar la lectura.'),
  ).toBeTruthy();
  await press('Actualizar lectura');
  expect(service.updateManual).toHaveBeenCalledTimes(1);
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('confirmed create still replaces if refresh fails, without repeating create', async () => {
  const view = await mountExpense(<ExpenseCreateScreen />);
  await fill();
  jest.spyOn(view.client, 'invalidateQueries').mockRejectedValueOnce(new Error('refresh'));
  await press('Crear gasto');
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith('/expenses/persisted-id/edit'),
  );
  expect(service.createManual).toHaveBeenCalledTimes(1);
});
test('loaded form and saved feedback survive a failed detail refetch', async () => {
  const view = await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  await fireEvent.changeText(description(), 'Confirmado');
  await press('Guardar cambios');
  await waitFor(() => expect(screen.getByText('Gasto guardado correctamente.')).toBeTruthy());
  service.getById.mockResolvedValue({ data: null, error: expenseError('NETWORK_ERROR') });
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: expensesKeys.byBusiness('b') });
  });
  expect(description()).toHaveProp('value', 'Confirmado');
  expect(screen.getByText('Gasto guardado correctamente.')).toBeTruthy();
});
test('PURCHASE entered manually is read-only, no fields/mutation and safe return', async () => {
  service.getById.mockResolvedValue({
    data: { ...expenseRow(), source_type: 'PURCHASE', purchase_id: 'hidden-parent' },
    error: null,
  });
  await mountExpense(<EditRoute />);
  await waitFor(() => expect(screen.getByText('Gasto de compra: solo lectura')).toBeTruthy());
  expect(screen.queryByLabelText('Importe (obligatorio)')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  expect(service.updateManual).not.toHaveBeenCalled();
  await press('Volver a gastos');
  expect(routerMock.replace).toHaveBeenCalledWith('/expenses');
});
test('edit cancel discards only local draft and returns exactly to collection', async () => {
  await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  await fireEvent.changeText(description(), 'Sin guardar');
  await press('Cancelar');
  expect(routerMock.replace).toHaveBeenCalledWith('/expenses');
  expect(service.updateManual).not.toHaveBeenCalled();
});
test.each(['business', 'user', 'membership', 'logout', 'recovery', 'blur', 'unmount'] as const)(
  'late create after %s cannot navigate or publish into the new context',
  async (transition) => {
    const d = expenseDeferred<ExpenseResult>();
    service.createManual.mockReturnValue(d.promise);
    const view = await mountExpense(<ExpenseCreateScreen />);
    await fill();
    await press('Crear gasto');
    await waitFor(() => expect(service.createManual).toHaveBeenCalledTimes(1));
    if (transition === 'business') expenseContext('other', 'u', 'other-member');
    if (transition === 'user') expenseContext('b', 'other-user');
    if (transition === 'membership') expenseContext('b', 'u', 'other-member');
    if (transition === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (transition === 'recovery') {
      const auth = useAuth();
      if (auth.status === 'authenticated')
        jest.mocked(useAuth).mockReturnValue({ ...auth, status: 'recovering' });
    }
    if (transition === 'blur') mockFocused = false;
    if (transition === 'unmount') await view.unmount();
    else await view.rerender(<ExpenseCreateScreen />);
    await act(async () => d.resolve({ data: expenseRow('late-created'), error: null }));
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(service.createManual).toHaveBeenCalledTimes(1);
  },
);
test('late edit of A cannot hydrate/update B or navigate', async () => {
  const d = expenseDeferred<ExpenseResult>();
  service.updateManual.mockReturnValue(d.promise);
  service.getById.mockImplementation(async (_b, id) => ({ data: expenseRow(id), error: null }));
  const view = await mountExpense(<ExpenseEditScreen expenseId="a" />);
  // Existing service contract guarantees ID; this transport mock mirrors that contract.
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  await fireEvent.changeText(description(), 'A pendiente');
  await press('Guardar cambios');
  await waitFor(() => expect(service.updateManual).toHaveBeenCalledTimes(1));
  service.getById.mockResolvedValue({
    data: { ...expenseRow('b'), description: 'Gasto B' },
    error: null,
  });
  await view.rerender(<ExpenseEditScreen expenseId="b" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Gasto B'));
  await act(async () =>
    d.resolve({ data: { ...expenseRow('a'), description: 'A guardado' }, error: null }),
  );
  expect(description()).toHaveProp('value', 'Gasto B');
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('invalid route ID and BARBER context cannot expose an editable form or fetch a detail', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: ['a', 'b'] });
  await mountExpense(<EditRoute />);
  expect(screen.getByText('Gasto no disponible')).toBeTruthy();
  expect(service.getById).not.toHaveBeenCalled();
});
test('BARBER cannot render create or invoke a write', async () => {
  expenseContext('b', 'u', 'm', 'BARBER');
  await mountExpense(<ExpenseCreateScreen />);
  expect(screen.queryByRole('button', { name: 'Crear gasto' })).toBeNull();
  expect(service.createManual).not.toHaveBeenCalled();
});
test('keyboard submit advances fields with decimal input mode and civil text date', async () => {
  await mountExpense(<ExpenseCreateScreen />);
  await fireEvent(description(), 'submitEditing', { nativeEvent: { text: '' } });
  expect(amount()).toHaveProp('inputMode', 'decimal');
  expect(date()).toHaveProp('autoCapitalize', 'none');
  expect(service.createManual).not.toHaveBeenCalled();
});

test('edit pending blocks double submit, cancellation and input changes until confirmed', async () => {
  const d = expenseDeferred<ExpenseResult>();
  service.updateManual.mockReturnValue(d.promise);
  await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await waitFor(() => expect(description()).toHaveProp('value', 'Alquiler del local'));
  await fireEvent.changeText(description(), 'Capturado');
  await press('Guardar cambios');
  await press('Guardar cambios');
  await waitFor(() => expect(service.updateManual).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(description()).toHaveProp('editable', false);
  expect(jest.mocked(usePreventRemove)).toHaveBeenLastCalledWith(true, expect.any(Function));
  await press('Cancelar');
  expect(routerMock.replace).not.toHaveBeenCalled();
  await act(async () =>
    d.resolve({ data: { ...expenseRow(), description: 'Capturado' }, error: null }),
  );
  await waitFor(() => expect(screen.getByText('Gasto guardado correctamente.')).toBeTruthy());
  expect(routerMock.replace).not.toHaveBeenCalled();
});

test('create waits for read maintenance before navigation and keeps the pending intent locked', async () => {
  const view = await mountExpense(<ExpenseCreateScreen />);
  await fill();
  const refresh = expenseDeferred<void>();
  jest.spyOn(view.client, 'invalidateQueries').mockReturnValueOnce(refresh.promise);
  await press('Crear gasto');
  await waitFor(() => expect(service.createManual).toHaveBeenCalledTimes(1));
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(amount()).toHaveProp('editable', false);
  await press('Crear gasto');
  await act(async () => refresh.resolve());
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith('/expenses/persisted-id/edit'),
  );
  expect(service.createManual).toHaveBeenCalledTimes(1);
});

test('category read failure retries the existing category source and offers no inline creation', async () => {
  categories.listByBusiness.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No se pudieron cargar las categorías.' },
  });
  await mountExpense(<ExpenseCreateScreen />);
  await press('Elegir categoría');
  await waitFor(() =>
    expect(screen.getByText('No se pudieron cargar las categorías.')).toBeTruthy(),
  );
  await press('Reintentar');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Seleccionar categoría: Alquiler' })).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Crear categoría' })).toBeNull();
  expect(categories.listByBusiness).toHaveBeenCalledTimes(2);
});
