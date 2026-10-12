import { screen, userEvent } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import DetailRoute from '@/app/(app)/clients/[id]';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import {
  useClientDetail,
  type UseClientDetailResult,
} from '@/features/clients/hooks/useClientDetail';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { ClientDetailScreen } from '@/features/clients/screens/ClientDetailScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientDetail', () => ({ useClientDetail: jest.fn() }));
jest.mock('expo-router', () => {
  const { routerMock } =
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils');
  return { router: { ...routerMock, canGoBack: jest.fn() }, useLocalSearchParams: jest.fn() };
});

const businessMock = jest.mocked(useBusiness);
const detailMock = jest.mocked(useClientDetail);
const paramsMock = jest.mocked(useLocalSearchParams);
const canGoBackMock = jest.mocked(router.canGoBack);
const business = (
  id = 'business-a',
  timezone = 'America/Argentina/Buenos_Aires',
): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'membership',
    role: 'BARBER',
    business: { id, name: 'Test business', currency_code: 'ARS', timezone, is_active: true },
  },
});
const client: ClientRow = {
  id: 'client-a',
  business_id: 'business-a',
  first_name: 'Martín',
  last_name: 'Pérez',
  phone: 'Llamar al interno X',
  email: 'Texto libre de email',
  instagram: 'Instagram libre',
  birth_date: '2000-02-29',
  notes: 'Primera línea\nSegunda línea',
  preferences: 'Sin perfume',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};
const success = (row = client, isFetching = false): UseClientDetailResult => ({
  status: 'success',
  data: row,
  error: null,
  isFetching,
});
const idle: UseClientDetailResult = { status: 'idle', data: null, error: null, isFetching: false };
const pending: UseClientDetailResult = {
  status: 'pending',
  data: null,
  error: null,
  isFetching: true,
};
const press = (label: string) => userEvent.press(screen.getByRole('button', { name: label }));

beforeEach(() => {
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  detailMock.mockReset().mockImplementation((id) => (id === null ? idle : success()));
  paramsMock.mockReturnValue({ id: 'client-a' });
  canGoBackMock.mockReturnValue(true);
});

test('detail route passes original scalar id and renders all thirteen read-only fields', async () => {
  paramsMock.mockReturnValue({ id: '  unmodified-id  ' });
  await renderWithProviders(<DetailRoute />);
  expect(detailMock).toHaveBeenLastCalledWith('  unmodified-id  ');
  expect(screen.getByRole('heading', { name: 'Detalle de cliente' })).toBeOnTheScreen();
  expect(screen.getByRole('heading', { name: 'Martín Pérez' })).toBeOnTheScreen();
  for (const [label, value] of [
    ['Nombre', client.first_name],
    ['Apellido', client.last_name],
    ['Teléfono', client.phone],
    ['Email', client.email],
    ['Instagram', client.instagram],
    ['Fecha de nacimiento', client.birth_date],
    ['Notas', client.notes],
    ['Preferencias', client.preferences],
    ['ID del cliente', client.id],
    ['ID del negocio', client.business_id],
  ])
    expect(screen.getByLabelText(`${label}: ${value}`)).toBeOnTheScreen();
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  expect(screen.getByRole('heading', { name: 'Datos del registro' })).toBeOnTheScreen();
  expect(
    screen.getByLabelText(/^Creado \(America\/Argentina\/Buenos_Aires\): .*21:00$/),
  ).toBeOnTheScreen();
  expect(
    screen.getByLabelText(/^Actualizado \(America\/Argentina\/Buenos_Aires\): .*21:00$/),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Editar cliente' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Volver a clientes' })).toBeEnabled();
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(routerMock.back).not.toHaveBeenCalled();
});

test.each([undefined, '', '   ', [], ['client-a'], ['client-a', 'client-b']])(
  'unusable route parameter %j becomes unavailable without inventing an id',
  async (id) => {
    paramsMock.mockReturnValue(id === undefined ? {} : { id });
    await renderWithProviders(<DetailRoute />);
    expect(detailMock).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('status', { name: 'Cliente no disponible' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Editar cliente' })).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);

test('idle has unavailable UX, not a technical failure or previous client', async () => {
  detailMock.mockReturnValue(idle);
  await renderWithProviders(<DetailRoute />);
  expect(screen.getByRole('status', { name: 'Cliente no disponible' })).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(client.phone!)).toBeNull();
});

test('pending has accessible loading and no empty state, old data or edit action', async () => {
  detailMock.mockReturnValue(pending);
  await renderWithProviders(<DetailRoute />);
  expect(screen.getByRole('progressbar', { name: 'Cargando cliente…' })).toBeOnTheScreen();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Martín Pérez' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Editar cliente' })).toBeNull();
});

test('all nullable values show explicit absence and first name remains a usable heading', async () => {
  detailMock.mockReturnValue(
    success({
      ...client,
      first_name: 'Diego',
      last_name: null,
      phone: null,
      email: null,
      instagram: null,
      birth_date: null,
      notes: null,
      preferences: null,
    }),
  );
  await renderWithProviders(<DetailRoute />);
  expect(screen.getByRole('heading', { name: 'Diego' })).toBeOnTheScreen();
  for (const label of [
    'Apellido',
    'Teléfono',
    'Email',
    'Instagram',
    'Fecha de nacimiento',
    'Notas',
    'Preferencias',
  ]) {
    expect(screen.getByLabelText(`${label}: Sin datos`)).toBeOnTheScreen();
  }
});

test('empty text is preserved separately from null and original name spacing is not normalized', async () => {
  detailMock.mockReturnValue(
    success({ ...client, first_name: '  María del Mar  ', last_name: '', notes: '' }),
  );
  await renderWithProviders(<DetailRoute />);
  expect(
    screen.getByLabelText('Nombre:   María del Mar  ', {
      exact: true,
      normalizer: (value) => value,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByLabelText('Notas: ', { exact: true, normalizer: (value) => value }),
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText('Notas: Sin datos')).toBeNull();
});

test('inactive client is valid, visibly archived and can navigate to edit', async () => {
  detailMock.mockReturnValue(success({ ...client, is_active: false }));
  await renderWithProviders(<DetailRoute />);
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  expect(screen.getByRole('heading', { name: 'Martín Pérez' })).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
  await press('Editar cliente');
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/clients/[id]/edit',
    params: { id: client.id },
  });
});

test('edit uses the returned row id without modifying data or navigating automatically', async () => {
  detailMock.mockReturnValue(success({ ...client, id: 'returned-id' }));
  await renderWithProviders(<DetailRoute />);
  expect(routerMock.push).not.toHaveBeenCalled();
  await press('Editar cliente');
  expect(routerMock.push).toHaveBeenCalledTimes(1);
  expect(routerMock.push).toHaveBeenCalledWith({
    pathname: '/clients/[id]/edit',
    params: { id: 'returned-id' },
  });
});

test.each([true, false])(
  'safe back with history=%s does not depend on success',
  async (history) => {
    canGoBackMock.mockReturnValue(history);
    detailMock.mockReturnValue(idle);
    await renderWithProviders(<DetailRoute />);
    await press('Volver a clientes');
    if (history) {
      expect(routerMock.back).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).not.toHaveBeenCalled();
    } else {
      expect(routerMock.replace).toHaveBeenCalledWith('/clients');
      expect(routerMock.back).not.toHaveBeenCalled();
    }
  },
);

test('CLIENT_NOT_FOUND is missing/not-visible UX with safe message and no deletion claim', async () => {
  detailMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'CLIENT_NOT_FOUND', message: 'No encontramos un cliente disponible.' },
  });
  await renderWithProviders(<DetailRoute />);
  expect(
    screen.getByRole('status', {
      name: 'Cliente no encontrado. No encontramos un cliente disponible.',
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(/eliminado/i)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Editar cliente' })).toBeNull();
  expect(routerMock.replace).not.toHaveBeenCalled();
});

test.each(['NETWORK_ERROR', 'CLIENT_ACCESS_DENIED', 'UNKNOWN_ERROR'] as const)(
  '%s renders only safe error, no stale details, no automatic navigation',
  async (code) => {
    const rendered = await renderWithProviders(<DetailRoute />);
    detailMock.mockReturnValue({
      status: 'error',
      data: null,
      isFetching: false,
      error: Object.assign(
        { code, message: `Mensaje seguro ${code}` },
        { details: 'raw SQL secret', stack: 'SDK stack' },
      ),
    });
    await rendered.rerender(<DetailRoute />);
    expect(
      screen.getByRole('alert', { name: `Ocurrió un error. Mensaje seguro ${code}` }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('heading', { name: 'Martín Pérez' })).toBeNull();
    expect(screen.queryByText(client.phone!)).toBeNull();
    expect(screen.queryByText(/raw SQL|SDK stack/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar cliente' })).toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);

test('read retry invalidates only the current detail key and disables while fetching', async () => {
  detailMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: false,
    error: { code: 'NETWORK_ERROR', message: 'Mensaje seguro' },
  });
  const rendered = await renderWithProviders(<DetailRoute />);
  const invalidate = jest.spyOn(rendered.queryClient, 'invalidateQueries');
  await press('Reintentar');
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: clientsKeys.detail('business-a', 'client-a'),
    exact: true,
  });
  detailMock.mockReturnValue({
    status: 'error',
    data: null,
    isFetching: true,
    error: { code: 'NETWORK_ERROR', message: 'Mensaje seguro' },
  });
  await rendered.rerender(<DetailRoute />);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeBusy();
  await press('Reintentar');
  expect(invalidate).toHaveBeenCalledTimes(1);
  detailMock.mockReturnValue(success());
  await rendered.rerender(<DetailRoute />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Martín Pérez' })).toBeOnTheScreen();
});

test('changing route id removes the previous client while the new hook result loads', async () => {
  const rendered = await renderWithProviders(<DetailRoute />);
  paramsMock.mockReturnValue({ id: 'client-b' });
  detailMock.mockImplementation((id) => (id === 'client-b' ? pending : success()));
  await rendered.rerender(<DetailRoute />);
  expect(detailMock).toHaveBeenLastCalledWith('client-b');
  expect(screen.queryByRole('heading', { name: 'Martín Pérez' })).toBeNull();
  expect(screen.getByRole('progressbar', { name: 'Cargando cliente…' })).toBeOnTheScreen();
  detailMock.mockReturnValue(
    success({ ...client, id: 'client-b', first_name: 'Lucía', last_name: null }),
  );
  await rendered.rerender(<DetailRoute />);
  expect(screen.getByRole('heading', { name: 'Lucía' })).toBeOnTheScreen();
});

test('business transition uses the hook result without retaining a local row', async () => {
  const rendered = await renderWithProviders(<DetailRoute />);
  businessMock.mockReturnValue(business('business-b'));
  detailMock.mockReturnValue(pending);
  await rendered.rerender(<DetailRoute />);
  expect(screen.queryByLabelText('ID del negocio: business-a')).toBeNull();
  detailMock.mockReturnValue(
    success({ ...client, business_id: 'business-b', first_name: 'Cliente B', last_name: null }),
  );
  await rendered.rerender(<DetailRoute />);
  expect(screen.getByRole('heading', { name: 'Cliente B' })).toBeOnTheScreen();
  expect(screen.getByLabelText('ID del negocio: business-b')).toBeOnTheScreen();
});

test('loss of business context removes success details even during a stale render', async () => {
  const rendered = await renderWithProviders(<DetailRoute />);
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await rendered.rerender(<DetailRoute />);
  expect(screen.queryByRole('heading', { name: 'Martín Pérez' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Editar cliente' })).toBeNull();
  expect(screen.getByRole('status', { name: 'Cliente no disponible' })).toBeOnTheScreen();
});

test('audit timestamps use business timezone and civil birth date stays unchanged', async () => {
  const rendered = await renderWithProviders(<DetailRoute />);
  expect(screen.getByLabelText(/^Creado .*: .*31.*dic.*2025, 21:00$/)).toBeOnTheScreen();
  expect(screen.getByLabelText('Fecha de nacimiento: 2000-02-29')).toBeOnTheScreen();
  businessMock.mockReturnValue(business('business-a', 'UTC'));
  await rendered.rerender(<DetailRoute />);
  expect(screen.getByLabelText(/^Creado \(UTC\): .*1.*ene.*2026, 00:00$/)).toBeOnTheScreen();
  expect(screen.getByLabelText('Fecha de nacimiento: 2000-02-29')).toBeOnTheScreen();
});

test('unavailable audit metadata never crashes or silently uses device timezone', async () => {
  businessMock.mockReturnValue(business('business-a', 'invalid-timezone'));
  await renderWithProviders(<DetailRoute />);
  expect(screen.getByLabelText('Creado (invalid-timezone): Fecha no disponible')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Editar cliente' })).toBeEnabled();
});

test('long multiline content remains complete and no edit inputs or unrelated actions are added', async () => {
  const notes = `Inicio\n${'Contenido largo '.repeat(100)}\nFin`;
  const preferences = 'preferencia'.repeat(100);
  detailMock.mockReturnValue(success({ ...client, notes, preferences }));
  await renderWithProviders(<ClientDetailScreen clientId="client-a" />);
  expect(screen.getByLabelText(`Notas: ${notes}`)).toBeOnTheScreen();
  expect(screen.getByLabelText(`Preferencias: ${preferences}`)).toBeOnTheScreen();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  for (const label of [
    'Nombre (obligatorio)',
    'Crear cliente',
    'Archivar cliente',
    'Restaurar cliente',
  ]) {
    expect(screen.queryByLabelText(label)).toBeNull();
  }
  expect(
    screen.queryByText(/Estadísticas|Total gastado|Última visita|Historial de citas/),
  ).toBeNull();
});
