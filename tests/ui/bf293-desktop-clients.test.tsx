import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { useBusiness } from '@/features/business/context/BusinessContext';
import { useClients } from '@/features/clients/hooks/useClients';
import { useClientSearch } from '@/features/clients/hooks/useClientSearch';
import { useClientDetail } from '@/features/clients/hooks/useClientDetail';
import { useCreateClient } from '@/features/clients/hooks/useCreateClient';
import { useUpdateClient } from '@/features/clients/hooks/useUpdateClient';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { ClientsScreen } from '@/features/clients/screens/ClientsScreen';
import { ClientDetailScreen } from '@/features/clients/screens/ClientDetailScreen';
import { ClientCreateScreen } from '@/features/clients/screens/ClientCreateScreen';
import { ClientEditScreen } from '@/features/clients/screens/ClientEditScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { theme } from '@/theme';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/hooks/useClients', () => ({ useClients: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientSearch', () => ({ useClientSearch: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientDetail', () => ({ useClientDetail: jest.fn() }));
jest.mock('@/features/clients/hooks/useCreateClient', () => ({ useCreateClient: jest.fn() }));
jest.mock('@/features/clients/hooks/useUpdateClient', () => ({ useUpdateClient: jest.fn() }));
// The unchanged stats read is covered by the feature's existing tests.
jest.mock('@/features/clients/components/ClientStats', () => ({ ClientStats: () => null }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
jest.mock('expo-router', () => ({
  router: { ...jest.requireActual('@/test/routerTestUtils').routerMock, canGoBack: () => false },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const widths = [320, 390, 767, 768, 1024, 1200, 1280];
const original = Dimensions.get('window');
const resize = async (width: number) =>
  act(() => Dimensions.set({ window: { ...original, width } }));
const row: ClientRow = {
  id: 'client',
  business_id: 'business',
  first_name: 'María del Carmen Élodie',
  last_name: 'Pérez Gómez',
  phone: 'contacto privado',
  email: null,
  instagram: null,
  birth_date: null,
  notes: 'Texto largo\nSegunda línea',
  preferences: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const create = jest.fn(),
  update = jest.fn();
beforeEach(() => {
  resetRouterMocks();
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId: 'member',
      role: 'OWNER',
      business: {
        id: 'business',
        name: 'Demo',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
  jest.mocked(useClients).mockImplementation((params) => ({
    status: 'success',
    isFetching: false,
    error: null,
    data: { items: [row], page: params?.page ?? 1, pageSize: 25, hasNextPage: true },
  }));
  jest.mocked(useClientSearch).mockImplementation((params) => ({
    status: 'success',
    isFetching: false,
    error: null,
    data: { items: [row], page: params.page ?? 1, pageSize: 25, hasNextPage: true },
  }));
  jest
    .mocked(useClientDetail)
    .mockReturnValue({ status: 'success', isFetching: false, error: null, data: row });
  create.mockResolvedValue(row);
  update.mockResolvedValue(row);
  jest.mocked(useCreateClient).mockReturnValue({
    status: 'idle',
    data: null,
    error: null,
    reset: jest.fn(),
    mutateAsync: create,
  });
  jest.mocked(useUpdateClient).mockReturnValue({
    status: 'idle',
    data: null,
    error: null,
    reset: jest.fn(),
    mutateAsync: update,
  });
});
afterEach(async () => resize(original.width));

function expectContainer(heading: string, width: number) {
  let node: TestInstance | null = screen.getByRole('heading', { name: heading });
  while (node) {
    const style = StyleSheet.flatten(node.props.style);
    if (style?.width === '100%' && style.paddingHorizontal === theme.spacing[16]) {
      expect(style).toMatchObject({
        alignSelf: 'center',
        maxWidth: width >= 768 ? 1200 : undefined,
        paddingVertical: theme.spacing[16],
        gap: theme.spacing[24],
      });
      return;
    }
    node = node.parent;
  }
  throw new Error('Missing shared responsive content container');
}

test.each(widths)(
  'list width %s preserves controls, fields, routes and pagination',
  async (width) => {
    await resize(width);
    await renderWithProviders(<ClientsScreen />);
    expectContainer('Clientes', width);
    const item = screen.getByRole('button', {
      name: `Ver cliente ${row.first_name} ${row.last_name}, Activo`,
    });
    expect(StyleSheet.flatten(item.props.style).flexDirection).toBe(
      width >= 768 ? 'row' : undefined,
    );
    expect(screen.queryByText(row.phone!)).toBeNull();
    await fireEvent.press(item);
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/clients/[id]',
      params: { id: row.id },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
    expect(jest.mocked(useClients)).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 25,
      status: 'active',
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Anterior' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Archivados' }));
    expect(jest.mocked(useClients)).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 25,
      status: 'inactive',
    });
    await fireEvent.changeText(screen.getByLabelText('Buscar clientes'), 'María');
    expect(jest.mocked(useClientSearch)).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 25,
      status: 'inactive',
      term: 'María',
    });
  },
);

test.each(widths)(
  'detail width %s keeps existing information and edit navigation',
  async (width) => {
    await resize(width);
    await renderWithProviders(<ClientDetailScreen clientId="client" />);
    expectContainer('Detalle de cliente', width);
    expect(screen.getByText(row.first_name)).toBeOnTheScreen();
    expect(screen.getByText(row.notes!)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Editar cliente' }));
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/clients/[id]/edit',
      params: { id: 'client' },
    });
  },
);

for (const mode of ['create', 'edit'] as const) {
  test.each(widths)(
    `${mode} width %s keeps original field/keyboard order and normal route`,
    async (width) => {
      await resize(width);
      await renderWithProviders(
        mode === 'create' ? <ClientCreateScreen /> : <ClientEditScreen clientId="client" />,
      );
      expectContainer(mode === 'create' ? 'Nuevo cliente' : 'Editar cliente', width);
      for (const label of [
        'Nombre (obligatorio)',
        'Apellido',
        'Teléfono',
        'Email',
        'Instagram',
        'Fecha de nacimiento',
        'Notas',
        'Preferencias',
      ])
        expect(screen.getByLabelText(label)).toBeOnTheScreen();
      expect(screen.queryByRole('dialog')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
      expect(routerMock.replace).toHaveBeenCalledWith('/clients');
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );
}

test('resizing preserves search, filter and current page instead of remounting list state', async () => {
  await resize(390);
  await renderWithProviders(<ClientsScreen />);
  await fireEvent.changeText(screen.getByLabelText('Buscar clientes'), 'María');
  await fireEvent.press(screen.getByRole('button', { name: 'Todos' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
  await resize(1280);
  expect(screen.getByLabelText('Buscar clientes').props.value).toBe('María');
  expect(screen.getByRole('button', { name: 'Todos' })).toBeSelected();
  expect(jest.mocked(useClientSearch)).toHaveBeenLastCalledWith({
    page: 2,
    pageSize: 25,
    status: 'all',
    term: 'María',
  });
});

test('resizing keeps dirty draft and archive confirmation; save still sends the same dirty patch', async () => {
  await resize(390);
  await renderWithProviders(<ClientEditScreen clientId="client" />);
  await fireEvent.changeText(screen.getByLabelText('Nombre (obligatorio)'), 'Nombre editado');
  await fireEvent.press(screen.getByRole('button', { name: 'Archivar cliente' }));
  await resize(1280);
  expect(screen.getByLabelText('Nombre (obligatorio)').props.value).toBe('Nombre editado');
  expect(screen.getByRole('button', { name: 'Confirmar archivo' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Confirmar archivo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({
      clientId: 'client',
      input: { first_name: 'Nombre editado', is_active: false },
    }),
  );
  expect(routerMock.replace).toHaveBeenCalledWith({
    pathname: '/clients/[id]',
    params: { id: 'client' },
  });
});
