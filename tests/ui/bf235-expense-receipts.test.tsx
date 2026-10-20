import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { openURL } from 'expo-linking';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  ExpenseCreateScreen,
  ExpenseEditScreen,
} from '@/features/expenses/screens/ManualExpenseScreen';
import { expensesService } from '@/features/expenses/services/expensesService';
import { expenseCategoriesService } from '@/features/expenses/services/expenseCategoriesService';
import { receiptPicker } from '@/features/expenses/services/receiptPicker';
import { storageService } from '@/lib/storage';
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
    getById: jest.fn(),
    createManual: jest.fn(),
    updateManual: jest.fn(),
    listByBusiness: jest.fn(),
  },
}));
jest.mock('@/features/expenses/services/expenseCategoriesService', () => ({
  expenseCategoriesService: {
    getById: jest.fn(),
    listByBusiness: jest.fn(),
  },
}));
jest.mock('@/features/expenses/services/receiptPicker', () => ({
  receiptPicker: { pick: jest.fn() },
}));
jest.mock('@/lib/storage', () => ({
  storageService: {
    upload: jest.fn(),
    remove: jest.fn(),
    createSignedUrl: jest.fn(),
  },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
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
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
const service = jest.mocked(expensesService),
  storage = jest.mocked(storageService);
const picker = jest.mocked(receiptPicker);
const oldPath = 'receipts/business/expense/old.pdf',
  newPath = 'receipts/business/expense/new.pdf';
const row = () => ({ ...expenseRow(), receipt_path: oldPath });
const picked = () => ({
  status: 'selected' as const,
  file: {
    name: 'Recibo.pdf',
    contentType: 'application/pdf' as const,
    size: 5,
    body: new Uint8Array([37, 80, 68, 70, 45]).buffer,
  },
});
const press = (name: string | RegExp) => userEvent.press(screen.getByRole('button', { name }));
async function edit() {
  const view = await mountExpense(<ExpenseEditScreen expenseId="expense-hidden-id" />);
  await screen.findByRole('button', { name: 'Seleccionar reemplazo' });
  return view;
}
beforeEach(() => {
  jest.clearAllMocks();
  expenseContext();
  mockFocused = true;
  notifyManager.setScheduler(queueMicrotask);
  service.getById.mockResolvedValue({ data: row(), error: null });
  service.createManual.mockResolvedValue({ data: { ...row(), receipt_path: null }, error: null });
  service.updateManual.mockImplementation(async (_b, _id, input) => ({
    data: { ...row(), ...input, amount: row().amount },
    error: null,
  }));
  jest
    .mocked(expenseCategoriesService)
    .getById.mockResolvedValue({ data: expenseCategory(), error: null });
  jest.mocked(expenseCategoriesService).listByBusiness.mockResolvedValue({
    data: { items: [expenseCategory()], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  picker.pick.mockResolvedValue(picked());
  storage.upload.mockResolvedValue({ data: { path: newPath }, error: null });
  storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.example.test/signed' },
    error: null,
  });
  jest.mocked(openURL).mockResolvedValue(true);
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));

it('selects safe metadata, uploads privately and patches only the confirmed path', async () => {
  const view = await edit();
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  await press('Seleccionar reemplazo');
  await screen.findByText(/Recibo.pdf/);
  expect(service.updateManual).not.toHaveBeenCalled();
  await press('Adjuntar comprobante');
  await waitFor(() =>
    expect(service.updateManual).toHaveBeenCalledWith('b', row().id, { receipt_path: newPath }),
  );
  expect(storage.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      target: { kind: 'expenseReceipt', businessId: 'b', expenseId: row().id },
      contentType: 'application/pdf',
    }),
  );
  expect(storage.remove).not.toHaveBeenCalled();
  expect(invalidation).toHaveBeenCalled();
  expect(screen.queryByText(/receipts\//)).toBeNull();
  expect(service.createManual).not.toHaveBeenCalled();
});
it('canceling picker retains current receipt without writes', async () => {
  picker.pick.mockResolvedValue({ status: 'cancelled' });
  await edit();
  await press('Seleccionar reemplazo');
  expect(screen.getByText('Hay un comprobante guardado.')).toBeTruthy();
  expect(storage.upload).not.toHaveBeenCalled();
  expect(service.updateManual).not.toHaveBeenCalled();
});
it.each(['Tipo no permitido', 'Archivo mayor a 10 MiB', 'Error del selector'])(
  'picker validation/error %s causes no write',
  async (message) => {
    picker.pick.mockResolvedValue({ status: 'error', message });
    await edit();
    await press('Seleccionar reemplazo');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(service.updateManual).not.toHaveBeenCalled();
  },
);
it('upload failure preserves old preview and retries only attachment', async () => {
  storage.upload.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Archivo no disponible' },
  });
  await edit();
  await press('Seleccionar reemplazo');
  await press('Adjuntar comprobante');
  await screen.findByText('Archivo no disponible');
  expect(service.updateManual).not.toHaveBeenCalled();
  await press('Preparar vista del comprobante');
  await screen.findByRole('button', { name: 'Abrir comprobante' });
  expect(storage.createSignedUrl).toHaveBeenCalledWith(oldPath);
  await press('Reintentar adjunto');
  await waitFor(() => expect(service.updateManual).toHaveBeenCalledTimes(1));
  expect(service.createManual).not.toHaveBeenCalled();
  expect(storage.remove).not.toHaveBeenCalled();
});
it('failed pointer replacement retains old path; retry reuses confirmed upload', async () => {
  service.updateManual.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Error seguro' },
  });
  await edit();
  await press('Seleccionar reemplazo');
  await press('Adjuntar comprobante');
  await screen.findByText(/No se pudo adjuntar/);
  await press('Preparar vista del comprobante');
  await screen.findByRole('button', { name: 'Abrir comprobante' });
  expect(storage.createSignedUrl).toHaveBeenCalledWith(oldPath);
  await press('Reintentar adjunto');
  await waitFor(() => expect(service.updateManual).toHaveBeenCalledTimes(2));
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.remove).not.toHaveBeenCalled();
});
it('creates exactly once before attachment failure then navigates with a safe outcome flag', async () => {
  storage.upload.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Error archivo' },
  });
  await mountExpense(<ExpenseCreateScreen />);
  await press('Seleccionar comprobante');
  await fireEvent.changeText(screen.getByLabelText('Importe (obligatorio)'), '10.50');
  await fireEvent.changeText(
    screen.getByLabelText('Fecha del gasto (YYYY-MM-DD, obligatoria)'),
    '2026-09-20',
  );
  await press('Elegir categoría');
  await press('Seleccionar categoría: Alquiler');
  await press('Medio de pago: Efectivo');
  await press('Crear gasto');
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/expenses/expense-hidden-id/edit?receiptFailed=1',
    ),
  );
  expect(service.createManual).toHaveBeenCalledTimes(1);
  expect(service.updateManual).not.toHaveBeenCalled();
  expect(service.createManual.mock.invocationCallOrder[0]).toBeLessThan(
    storage.upload.mock.invocationCallOrder[0],
  );
});
it('create with confirmed attachment navigates normally with path only in attachment update', async () => {
  await mountExpense(<ExpenseCreateScreen />);
  await press('Seleccionar comprobante');
  await fireEvent.changeText(screen.getByLabelText('Importe (obligatorio)'), '10');
  await fireEvent.changeText(
    screen.getByLabelText('Fecha del gasto (YYYY-MM-DD, obligatoria)'),
    '2026-09-20',
  );
  await press('Elegir categoría');
  await press('Seleccionar categoría: Alquiler');
  await press('Medio de pago: Efectivo');
  await press('Crear gasto');
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith('/expenses/expense-hidden-id/edit'),
  );
  expect(service.createManual).toHaveBeenCalledTimes(1);
  expect(service.updateManual).toHaveBeenCalledWith('b', row().id, { receipt_path: newPath });
  expect(JSON.stringify(service.createManual.mock.calls)).not.toContain('receipt_path');
});
it('attachment retry on persisted create destination never calls create', async () => {
  await mountExpense(<ExpenseEditScreen expenseId={row().id} receiptFailed />);
  await screen.findByText(/vuelve a seleccionarlo/);
  await press('Seleccionar reemplazo');
  await press('Adjuntar comprobante');
  await waitFor(() => expect(service.updateManual).toHaveBeenCalledTimes(1));
  expect(service.createManual).not.toHaveBeenCalled();
});
it('previews only on demand, opens temporary URL and never persists it', async () => {
  await edit();
  expect(storage.createSignedUrl).not.toHaveBeenCalled();
  await press('Preparar vista del comprobante');
  await press('Abrir comprobante');
  expect(openURL).toHaveBeenCalledWith('https://storage.example.test/signed');
  expect(service.updateManual).not.toHaveBeenCalled();
  expect(screen.queryByText(/storage.example|receipts\//)).toBeNull();
});
it('signing failure can retry without writes', async () => {
  storage.createSignedUrl.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Safe' },
  });
  await edit();
  await press('Preparar vista del comprobante');
  await screen.findByText(/vista no está disponible/);
  await press('Reintentar vista del comprobante');
  await screen.findByRole('button', { name: 'Abrir comprobante' });
  expect(service.updateManual).not.toHaveBeenCalled();
});
it('expired or failed external opening requests a fresh signed URL', async () => {
  await edit();
  await press('Preparar vista del comprobante');
  await screen.findByRole('button', { name: 'Abrir comprobante' });
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 300_001);
  await press('Abrir comprobante');
  expect(openURL).not.toHaveBeenCalled();
  await press('Reintentar vista del comprobante');
  await screen.findByRole('button', { name: 'Abrir comprobante' });
  jest.mocked(openURL).mockRejectedValueOnce(new Error('private URL must not leak'));
  await press('Abrir comprobante');
  await screen.findByText(/vista no está disponible/);
  expect(screen.queryByText(/private URL/)).toBeNull();
});
it('PURCHASE cannot select, attach or preview editable receipt controls', async () => {
  service.getById.mockResolvedValue({
    data: { ...row(), source_type: 'PURCHASE', purchase_id: 'p' },
    error: null,
  });
  await mountExpense(<ExpenseEditScreen expenseId={row().id} />);
  await screen.findByText('Gasto de compra: solo lectura');
  expect(screen.queryByRole('button', { name: /comprobante|reemplazo/i })).toBeNull();
  expect(storage.upload).not.toHaveBeenCalled();
});
it.each(['business', 'user', 'membership', 'expense', 'logout', 'recovery', 'focus', 'unmount'])(
  'late upload cannot patch after %s changes',
  async (change) => {
    const deferred = expenseDeferred<Awaited<ReturnType<typeof storageService.upload>>>();
    storage.upload.mockReturnValue(deferred.promise);
    const view = await edit();
    await press('Seleccionar reemplazo');
    await press('Adjuntar comprobante');
    if (change === 'business') expenseContext('other');
    if (change === 'user') expenseContext('b', 'other-user');
    if (change === 'membership') expenseContext('b', 'u', 'other-member');
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (change === 'recovery') {
      const auth = useAuth();
      if (auth.status === 'authenticated')
        jest.mocked(useAuth).mockReturnValue({ ...auth, status: 'recovering' });
    }
    if (change === 'focus') mockFocused = false;
    if (change === 'unmount') await view.unmount();
    else
      await view.rerender(
        <ExpenseEditScreen expenseId={change === 'expense' ? 'other-expense' : row().id} />,
      );
    await act(async () => deferred.resolve({ data: { path: newPath }, error: null }));
    expect(service.updateManual).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  },
);
it('late signing cannot open after logout', async () => {
  const deferred = expenseDeferred<Awaited<ReturnType<typeof storageService.createSignedUrl>>>();
  storage.createSignedUrl.mockReturnValue(deferred.promise);
  const view = await edit();
  await press('Preparar vista del comprobante');
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await view.rerender(<ExpenseEditScreen expenseId={row().id} />);
  await act(async () =>
    deferred.resolve({ data: { signedUrl: 'https://private.example/signed' }, error: null }),
  );
  expect(screen.queryByRole('button', { name: 'Abrir comprobante' })).toBeNull();
  expect(openURL).not.toHaveBeenCalled();
});
