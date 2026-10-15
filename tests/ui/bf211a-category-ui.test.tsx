import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { expenseCategoriesService } from '@/features/expenses/services/expenseCategoriesService';
import { ExpenseCategoriesScreen } from '@/features/expenses/screens/ExpenseCategoriesScreen';
import { ExpenseCategoryCreateScreen } from '@/features/expenses/screens/ExpenseCategoryCreateScreen';
import { ExpenseCategoryEditScreen } from '@/features/expenses/screens/ExpenseCategoryEditScreen';
import { expenseCategoriesKeys } from '@/features/expenses/constants/expenseCategoriesKeys';
import type { ExpenseCategoryRow } from '@/features/expenses/repositories/expenseCategoriesRepository';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import SettingsScreen from '@/app/(app)/(tabs)/settings';

jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/expenses/services/expenseCategoriesService', () => ({
  expenseCategoriesService: {
    getById: jest.fn(),
    listByBusiness: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({
  router: {
    ...jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
    canGoBack: () => false,
  },
}));
const service = jest.mocked(expenseCategoriesService);
const businessMock = jest.mocked(useBusiness);
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm',
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const row: ExpenseCategoryRow = {
  id: 'c',
  business_id: 'b',
  name: 'Alquiler',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));
const change = (value: string) =>
  fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), value);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  service.listByBusiness.mockResolvedValue({
    data: { items: [row], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  service.getById.mockResolvedValue({ data: row, error: null });
  service.create.mockResolvedValue({ data: row, error: null });
  service.update.mockResolvedValue({ data: row, error: null });
});
test('OWNER list opens approved routes and filters; BARBER cannot see cached rows or query', async () => {
  const view = await renderWithProviders(<ExpenseCategoriesScreen />);
  await waitFor(() => expect(screen.getByText('Alquiler')).toBeTruthy());
  await press('Crear categoría');
  expect(routerMock.push).toHaveBeenCalledWith('/expenses/categories/new');
  await press('Editar categoría Alquiler, Activa');
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/expenses/categories/[id]/edit',
    params: { id: 'c' },
  });
  await press('Archivadas');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      status: 'inactive',
    }),
  );
  businessMock.mockReturnValue(business('b', 'BARBER'));
  service.listByBusiness.mockClear();
  await view.rerender(<ExpenseCategoriesScreen />);
  expect(screen.getByText('Acceso restringido')).toBeTruthy();
  expect(screen.queryByText('Alquiler')).toBeNull();
  expect(service.listByBusiness).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Crear categoría' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Editar categoría/ })).toBeNull();
});
test('empty success differs from safe read error and explicit retry', async () => {
  service.listByBusiness.mockResolvedValue({
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  const client = createTestQueryClient();
  await renderWithProviders(<ExpenseCategoriesScreen />, { queryClient: client });
  await waitFor(() => expect(screen.getByText('No hay categorías activas.')).toBeTruthy());
  service.listByBusiness.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' },
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: expenseCategoriesKeys.byBusiness('b') });
  });
  await waitFor(() => expect(screen.getByText('Sin conexión.')).toBeTruthy());
  service.listByBusiness.mockResolvedValue({
    data: { items: [row], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  await press('Reintentar');
  await waitFor(() => expect(screen.getByText('Alquiler')).toBeTruthy());
});
test.each(['BARBER'] as const)('%s cannot mount administrative forms', async (role) => {
  businessMock.mockReturnValue(business('b', role));
  const view = await renderWithProviders(<ExpenseCategoryCreateScreen />);
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
  expect(service.create).not.toHaveBeenCalled();
  await view.rerender(<ExpenseCategoryEditScreen expenseCategoryId="c" />);
  expect(service.getById).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
});
test('create rejects spaces, preserves text and uses persisted id for navigation', async () => {
  await renderWithProviders(<ExpenseCategoryCreateScreen />);
  await change('   ');
  await press('Crear categoría');
  expect(service.create).not.toHaveBeenCalled();
  await change('  Insumos  ');
  await press('Crear categoría');
  await waitFor(() => expect(service.create).toHaveBeenCalledWith('b', { name: '  Insumos  ' }));
  expect(routerMock.replace).toHaveBeenCalledWith({
    pathname: '/expenses/categories/[id]/edit',
    params: { id: 'c' },
  });
});
test('create failure preserves draft and allows retry without technical error', async () => {
  service.create.mockResolvedValueOnce({
    data: null,
    error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar.' },
  });
  await renderWithProviders(<ExpenseCategoryCreateScreen />);
  await change(' Insumos ');
  await press('Crear categoría');
  await waitFor(() => expect(screen.getByText('No se pudo guardar.')).toBeTruthy());
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe(' Insumos ');
  expect(routerMock.replace).not.toHaveBeenCalled();
  await press('Crear categoría');
  await waitFor(() => expect(service.create).toHaveBeenCalledTimes(2));
});
test('pending creation prevents double calls and old-tenant completion cannot navigate new tenant', async () => {
  const pending = deferred<Awaited<ReturnType<typeof expenseCategoriesService.create>>>();
  service.create.mockReturnValueOnce(pending.promise);
  const view = await renderWithProviders(<ExpenseCategoryCreateScreen />);
  await change('Insumos');
  await act(async () => {
    await fireEvent.press(screen.getByRole('button', { name: 'Crear categoría' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Crear categoría' }));
  });
  await waitFor(() => expect(service.create).toHaveBeenCalledTimes(1));
  businessMock.mockReturnValue(business('other'));
  await view.rerender(<ExpenseCategoryCreateScreen />);
  await act(async () => pending.resolve({ data: row, error: null }));
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('');
});
test('edit only sends dirty name, stays and shows persisted result', async () => {
  service.update.mockResolvedValue({ data: { ...row, name: 'Persistida' }, error: null });
  await renderWithProviders(<ExpenseCategoryEditScreen expenseCategoryId="c" />);
  await waitFor(() => expect(screen.getByLabelText('Nombre (obligatorio)')).toBeTruthy());
  await change('  Otro  ');
  await press('Guardar cambios');
  await waitFor(() => expect(service.update).toHaveBeenCalledWith('b', 'c', { name: '  Otro  ' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Persistida'),
  );
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('archive requires confirmation, sends only status, preserves dirty draft and allows restoration', async () => {
  service.update
    .mockResolvedValueOnce({ data: { ...row, is_active: false }, error: null })
    .mockResolvedValueOnce({ data: { ...row, is_active: true }, error: null });
  await renderWithProviders(<ExpenseCategoryEditScreen expenseCategoryId="c" />);
  await waitFor(() => expect(screen.getByLabelText('Nombre (obligatorio)')).toBeTruthy());
  await change('Borrador');
  await press('Archivar categoría');
  expect(service.update).not.toHaveBeenCalled();
  await press('Confirmar archivo');
  await waitFor(() => expect(service.update).toHaveBeenCalledWith('b', 'c', { is_active: false }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Restaurar categoría' })).toBeTruthy(),
  );
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Borrador');
  await press('Restaurar categoría');
  await press('Confirmar restauración');
  await waitFor(() =>
    expect(service.update).toHaveBeenLastCalledWith('b', 'c', { is_active: true }),
  );
});
test('cancel uses safe category fallback and never saves', async () => {
  await renderWithProviders(<ExpenseCategoryCreateScreen />);
  await press('Cancelar');
  expect(routerMock.replace).toHaveBeenCalledWith('/expenses/categories');
  expect(service.create).not.toHaveBeenCalled();
});

test('category listing follows sentinel pagination and resets page after changing status', async () => {
  service.listByBusiness.mockImplementation(async (_businessId, params) => ({
    data: { items: [row], page: params?.page ?? 1, pageSize: 25, hasNextPage: params?.page === 1 },
    error: null,
  }));
  await renderWithProviders(<ExpenseCategoriesScreen />);
  await waitFor(() => expect(screen.getByText('Alquiler')).toBeTruthy());
  await press('Siguiente');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 2,
      pageSize: 25,
      status: 'active',
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Siguiente' }).props.accessibilityState.disabled,
    ).toBe(true),
  );
  await press('Todas');
  await waitFor(() =>
    expect(service.listByBusiness).toHaveBeenLastCalledWith('b', {
      page: 1,
      pageSize: 25,
      status: 'all',
    }),
  );
});

test('failed archive preserves confirmation, draft and active state for explicit retry', async () => {
  service.update.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' },
  });
  await renderWithProviders(<ExpenseCategoryEditScreen expenseCategoryId="c" />);
  await waitFor(() => expect(screen.getByLabelText('Nombre (obligatorio)')).toBeTruthy());
  await change('Borrador');
  await press('Archivar categoría');
  await press('Confirmar archivo');
  await waitFor(() => expect(screen.getByText('Sin conexión.')).toBeTruthy());
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Borrador');
  expect(screen.getByRole('button', { name: 'Confirmar archivo' })).toBeTruthy();
  expect(service.update).toHaveBeenCalledTimes(1);
  service.update.mockResolvedValueOnce({ data: { ...row, is_active: false }, error: null });
  await press('Confirmar archivo');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Restaurar categoría' })).toBeTruthy(),
  );
  expect(service.update).toHaveBeenLastCalledWith('b', 'c', { is_active: false });
});

test('Settings provides the single approved expense-category entry', async () => {
  await renderWithProviders(<SettingsScreen />);
  expect(screen.getAllByRole('button', { name: 'Categorías de gastos' })).toHaveLength(1);
  await press('Categorías de gastos');
  expect(routerMock.push).toHaveBeenCalledWith('/expenses/categories');
});
