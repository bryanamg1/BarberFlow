import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import ClientsRoute from '@/app/(app)/(tabs)/clients';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import type { UseClientsResult } from '@/features/clients/hooks/clientHook.types';
import { useClientSearch } from '@/features/clients/hooks/useClientSearch';
import { useClients } from '@/features/clients/hooks/useClients';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { ClientsScreen } from '@/features/clients/screens/ClientsScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { theme } from '@/theme';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/hooks/useClients', () => ({ useClients: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientSearch', () => ({ useClientSearch: jest.fn() }));

const businessMock = jest.mocked(useBusiness);
const listMock = jest.mocked(useClients);
const searchMock = jest.mocked(useClientSearch);
const business = (id = 'business-a'): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'membership',
    role: 'BARBER',
    business: {
      id,
      name: 'Test business',
      currency_code: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
});
const client: ClientRow = {
  id: 'client-a',
  business_id: 'business-a',
  first_name: 'Martín',
  last_name: 'Pérez',
  phone: 'contact-not-for-list',
  email: 'private@example.test',
  instagram: null,
  birth_date: null,
  notes: 'private notes',
  preferences: 'private preferences',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const success = (items = [client], page = 1, hasNextPage = true): UseClientsResult => ({
  status: 'success',
  data: { items, page, pageSize: 25, hasNextPage },
  error: null,
  isFetching: false,
});
const pending: UseClientsResult = { status: 'pending', data: null, error: null, isFetching: true };
const failure: UseClientsResult = {
  status: 'error',
  data: null,
  isFetching: false,
  error: { code: 'NETWORK_ERROR', message: 'No pudimos cargar los clientes. Intenta nuevamente.' },
};
const searchInput = () => screen.getByLabelText('Buscar clientes');
const press = async (label: string) => userEvent.press(screen.getByRole('button', { name: label }));

beforeEach(() => {
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  listMock.mockImplementation((params) => success([client], params?.page));
  searchMock.mockImplementation((params) =>
    success(
      [{ ...client, id: 'search-client', first_name: 'Lucía', last_name: 'Gómez' }],
      params.page,
    ),
  );
});

test('existing route mounts accessible controls and only the default active list, page 1/25', async () => {
  await renderWithProviders(<ClientsRoute />);
  expect(screen.getByRole('heading', { name: 'Clientes' })).toBeOnTheScreen();
  expect(searchInput()).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Activos' })).toBeSelected();
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
  expect(searchMock).not.toHaveBeenCalled();
});

test('list shows name, nullable last name and archived status without contact or metadata', async () => {
  listMock.mockReturnValue(
    success([
      client,
      { ...client, id: 'second', first_name: 'Diego', last_name: null, is_active: false },
    ]),
  );
  await renderWithProviders(<ClientsScreen />);
  expect(
    screen.getByRole('button', { name: 'Ver cliente Martín Pérez, Activo' }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Ver cliente Diego, Archivado' })).toBeOnTheScreen();
  for (const text of [client.phone!, client.email!, client.notes!, client.preferences!]) {
    expect(screen.queryByText(text)).toBeNull();
  }
});

test.each(['idle', 'pending'] as const)('business %s gates hooks and creation', async (status) => {
  businessMock.mockReturnValue({
    status,
    data: null,
    error: null,
    isFetching: status === 'pending',
  } as BusinessContextValue);
  await renderWithProviders(<ClientsScreen />);
  if (status === 'pending')
    expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
  else expect(screen.getByRole('status', { name: /Negocio no disponible/ })).toBeOnTheScreen();
  expect(listMock).not.toHaveBeenCalled();
  expect(searchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Crear cliente' })).toBeNull();
});

test('business error displays its safe message without fetching clients', async () => {
  businessMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'NO_ACTIVE_MEMBERSHIP', message: 'No tienes un negocio disponible.' },
  });
  await renderWithProviders(<ClientsScreen />);
  expect(screen.getByRole('alert', { name: /No tienes un negocio disponible/ })).toBeOnTheScreen();
  expect(listMock).not.toHaveBeenCalled();
});

test('list pending is loading, not an empty result', async () => {
  listMock.mockReturnValue(pending);
  await renderWithProviders(<ClientsScreen />);
  expect(screen.getByRole('progressbar', { name: 'Cargando clientes…' })).toBeOnTheScreen();
  expect(screen.queryByText('No hay clientes activos.')).toBeNull();
});

test('empty list is success and differs for each status', async () => {
  listMock.mockReturnValue(success([], 1, false));
  await renderWithProviders(<ClientsScreen />);
  expect(screen.getByRole('status', { name: 'No hay clientes activos.' })).toBeOnTheScreen();
  await press('Archivados');
  expect(screen.getByRole('status', { name: 'No hay clientes archivados.' })).toBeOnTheScreen();
  await press('Todos');
  expect(screen.getByRole('status', { name: 'No hay clientes todavía.' })).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each(['', ' ', 'M', ' M '])(
  'short term %j stays in list without executing search',
  async (term) => {
    await renderWithProviders(<ClientsScreen />);
    await fireEvent.changeText(searchInput(), term);
    expect(
      screen.getByRole('button', { name: 'Ver cliente Martín Pérez, Activo' }),
    ).toBeOnTheScreen();
    expect(searchMock).not.toHaveBeenCalled();
  },
);

test('search trims boundaries, preserves literal characters and mounts only search results', async () => {
  await renderWithProviders(<ClientsScreen />);
  listMock.mockClear();
  await fireEvent.changeText(searchInput(), '  M_%  ');
  expect(searchMock).toHaveBeenLastCalledWith({
    term: 'M_%',
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  expect(listMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Ver cliente Martín/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ver cliente Lucía Gómez, Activo' })).toBeOnTheScreen();
  expect(searchInput()).toHaveProp('value', '  M_%  ');
});

test('clear search restores list and removes search results', async () => {
  await renderWithProviders(<ClientsScreen />);
  await fireEvent.changeText(searchInput(), 'Lu');
  await press('Limpiar búsqueda');
  expect(searchInput()).toHaveProp('value', '');
  expect(screen.getByRole('button', { name: /Ver cliente Martín/ })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Ver cliente Lucía/ })).toBeNull();
});

test('search pending never displays previous list results or fake empty', async () => {
  searchMock.mockReturnValue(pending);
  await renderWithProviders(<ClientsScreen />);
  await fireEvent.changeText(searchInput(), 'Lu');
  expect(screen.getByRole('progressbar', { name: 'Cargando clientes…' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Ver cliente Martín/ })).toBeNull();
  expect(screen.queryByText('No encontramos clientes para esta búsqueda.')).toBeNull();
});

test('changing search term removes the previous search rows while the new term is pending', async () => {
  searchMock.mockImplementation((params) =>
    params.term === 'Lu' ? success([{ ...client, first_name: 'Lucía', last_name: null }]) : pending,
  );
  await renderWithProviders(<ClientsScreen />);
  await fireEvent.changeText(searchInput(), 'Lu');
  expect(screen.getByRole('button', { name: 'Ver cliente Lucía, Activo' })).toBeOnTheScreen();
  await fireEvent.changeText(searchInput(), 'Ma');
  expect(screen.queryByRole('button', { name: /Ver cliente Lucía/ })).toBeNull();
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
});

test('client rows expose visible focus and the shared touch target', async () => {
  await renderWithProviders(<ClientsScreen />);
  const row = screen.getByRole('button', { name: 'Ver cliente Martín Pérez, Activo' });
  expect(row).toHaveStyle({ minHeight: theme.sizing.touchTarget });
  await fireEvent(row, 'focus');
  expect(row).toHaveStyle({ borderColor: theme.colors.primary });
  await fireEvent(row, 'blur');
  expect(row).toHaveStyle({ borderColor: theme.colors.border });
});

test('search empty communicates search outcome, not an empty client catalog', async () => {
  searchMock.mockReturnValue(success([], 1, false));
  await renderWithProviders(<ClientsScreen />);
  await fireEvent.changeText(searchInput(), 'zz');
  expect(
    screen.getByRole('status', { name: 'No encontramos clientes para esta búsqueda.' }),
  ).toBeOnTheScreen();
  expect(screen.queryByText('No hay clientes activos.')).toBeNull();
});

test.each(['list', 'search'] as const)(
  '%s error retries only its current business/key',
  async (mode) => {
    listMock.mockReturnValue(failure);
    searchMock.mockReturnValue(failure);
    const { queryClient } = await renderWithProviders(<ClientsScreen />);
    if (mode === 'search') await fireEvent.changeText(searchInput(), 'Lu');
    const params = { page: 1, pageSize: 25, status: 'active' as const };
    const key =
      mode === 'list'
        ? clientsKeys.list('business-a', params)
        : clientsKeys.search('business-a', { ...params, term: 'Lu' });
    const otherKey = clientsKeys.list('business-b', params);
    queryClient.setQueryData(key, 'owned test cache');
    queryClient.setQueryData(otherKey, 'other tenant');
    expect(screen.getByRole('alert', { name: /No pudimos cargar los clientes/ })).toBeOnTheScreen();
    await press('Reintentar');
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  },
);

test('retry is disabled while the existing read is fetching', async () => {
  listMock.mockReturnValue({ ...failure, isFetching: true });
  await renderWithProviders(<ClientsScreen />);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
});

test('list pagination uses hasNextPage and prevents previous below page 1', async () => {
  await renderWithProviders(<ClientsScreen />);
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await press('Anterior');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
  await press('Siguiente');
  expect(listMock).toHaveBeenLastCalledWith({ page: 2, pageSize: 25, status: 'active' });
  expect(screen.getByText('Página 2')).toBeOnTheScreen();
  await press('Anterior');
  expect(screen.getByText('Página 1')).toBeOnTheScreen();
});

test('false hasNextPage blocks advancing even on a full-looking page', async () => {
  listMock.mockReturnValue(success([client], 1, false));
  await renderWithProviders(<ClientsScreen />);
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await press('Siguiente');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
});

test('new page pending removes previous rows', async () => {
  listMock.mockImplementation((params) => (params?.page === 1 ? success() : pending));
  await renderWithProviders(<ClientsScreen />);
  await press('Siguiente');
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Ver cliente Martín/ })).toBeNull();
});

test('filter change resets list page and supplies inactive/all with selected semantics', async () => {
  await renderWithProviders(<ClientsScreen />);
  await press('Siguiente');
  await press('Archivados');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'inactive' });
  expect(screen.getByRole('button', { name: 'Archivados' })).toBeSelected();
  await press('Todos');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'all' });
});

test('search and filter changes reset page; whitespace-only edits preserve semantic search page', async () => {
  await renderWithProviders(<ClientsScreen />);
  await press('Siguiente');
  await fireEvent.changeText(searchInput(), 'Lu');
  expect(searchMock).toHaveBeenLastCalledWith({
    term: 'Lu',
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  await press('Siguiente');
  expect(searchMock).toHaveBeenLastCalledWith({
    term: 'Lu',
    page: 2,
    pageSize: 25,
    status: 'active',
  });
  await fireEvent.changeText(searchInput(), ' Lu ');
  expect(searchMock).toHaveBeenLastCalledWith({
    term: 'Lu',
    page: 2,
    pageSize: 25,
    status: 'active',
  });
  await fireEvent.changeText(searchInput(), 'Mar');
  expect(searchMock).toHaveBeenLastCalledWith({
    term: 'Mar',
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  await press('Siguiente');
  await press('Todos');
  expect(searchMock).toHaveBeenLastCalledWith({
    term: 'Mar',
    page: 1,
    pageSize: 25,
    status: 'all',
  });
});

test('create and detail navigate to existing placeholders with the exact client id', async () => {
  await renderWithProviders(<ClientsScreen />);
  await press('Crear cliente');
  expect(routerMock.push).toHaveBeenLastCalledWith('/clients/new');
  await press('Ver cliente Martín Pérez, Activo');
  expect(routerMock.push).toHaveBeenLastCalledWith({
    pathname: '/clients/[id]',
    params: { id: 'client-a' },
  });
});

test('tenant switch resets controls and never carries A rows into pending B', async () => {
  const rendered = await renderWithProviders(<ClientsScreen />);
  await fireEvent.changeText(searchInput(), 'Lu');
  await press('Todos');
  await press('Siguiente');
  businessMock.mockReturnValue(business('business-b'));
  listMock.mockReturnValue(pending);
  await rendered.rerender(<ClientsScreen />);
  expect(searchInput()).toHaveProp('value', '');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
  expect(screen.queryByRole('button', { name: /Ver cliente/ })).toBeNull();
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  listMock.mockReturnValue(
    success([
      {
        ...client,
        id: 'client-b',
        business_id: 'business-b',
        first_name: 'Cliente B',
        last_name: null,
      },
    ]),
  );
  await rendered.rerender(<ClientsScreen />);
  expect(screen.getByRole('button', { name: 'Ver cliente Cliente B, Activo' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Ver cliente Martín/ })).toBeNull();
});

test('business becoming unavailable unmounts all results immediately', async () => {
  const rendered = await renderWithProviders(<ClientsScreen />);
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await rendered.rerender(<ClientsScreen />);
  expect(screen.queryByRole('button', { name: /Ver cliente/ })).toBeNull();
  expect(screen.queryByLabelText('Buscar clientes')).toBeNull();
});
