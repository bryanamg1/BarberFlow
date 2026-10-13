import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import ServicesRoute from '@/app/(app)/services';
import SettingsRoute from '@/app/(app)/(tabs)/settings';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import type { UseServiceListResult } from '@/features/services/hooks/serviceHook.types';
import { useServiceList } from '@/features/services/hooks/useServiceList';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { ServicesScreen } from '@/features/services/screens/ServicesScreen';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { theme } from '@/theme';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/hooks/useServiceList', () => ({ useServiceList: jest.fn() }));
jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));

const businessMock = jest.mocked(useBusiness);
const listMock = jest.mocked(useServiceList);
const business = (
  id = 'business-a',
  role: 'OWNER' | 'BARBER' = 'OWNER',
  currency = 'ARS',
): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'membership',
    role,
    business: {
      id,
      name: 'Business',
      currency_code: currency,
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
});
const service: ServiceRow = {
  id: 'service-a',
  business_id: 'business-a',
  name: 'Corte',
  price: 10000,
  duration_minutes: 30,
  description: 'Hidden description',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const success = (items = [service], page = 1, hasNextPage = true): UseServiceListResult => ({
  status: 'success',
  data: { items, page, pageSize: 25, hasNextPage },
  error: null,
  isFetching: false,
});
const pending: UseServiceListResult = {
  status: 'pending',
  data: null,
  error: null,
  isFetching: true,
};
const failure: UseServiceListResult = {
  status: 'error',
  data: null,
  isFetching: false,
  error: { code: 'NETWORK_ERROR', message: 'No pudimos cargar los servicios. Intenta nuevamente.' },
};
const press = async (label: string | RegExp) =>
  userEvent.press(screen.getByRole('button', { name: label }));

beforeEach(() => {
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  listMock.mockImplementation((params) => success([service], params?.page));
});

test('thin route exposes heading, default active filter and page 1/25 without search', async () => {
  await renderWithProviders(<ServicesRoute />);
  expect(screen.getByRole('heading', { name: 'Servicios' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Activos' })).toBeSelected();
  expect(screen.getByRole('button', { name: 'Archivados' })).not.toBeSelected();
  expect(screen.getByRole('button', { name: 'Todos' })).not.toBeSelected();
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('rows preserve received order, active/archive status and only approved fields', async () => {
  listMock.mockReturnValue(
    success([
      { ...service, name: 'Zeta' },
      {
        ...service,
        id: 'second',
        name: 'Alfa',
        price: 5000,
        duration_minutes: 15,
        is_active: false,
      },
    ]),
  );
  await renderWithProviders(<ServicesScreen />);
  expect(
    screen
      .getAllByRole('button', { name: /^Editar servicio/ })
      .map((row) => row.props.accessibilityLabel),
  ).toEqual([
    'Editar servicio Zeta, ARS 10.000,00, 30 minutos, Activo',
    'Editar servicio Alfa, ARS 5.000,00, 15 minutos, Archivado',
  ]);
  expect(screen.getByText('ARS 10.000,00')).toBeOnTheScreen();
  expect(screen.getByText('30 minutos')).toBeOnTheScreen();
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  for (const text of [service.description!, service.business_id, service.created_at])
    expect(screen.queryByText(text)).toBeNull();
  expect(screen.queryByRole('button', { name: /Eliminar|Restaurar|Archivar/ })).toBeNull();
});

test.each(['USD', 'EUR'])(
  'price uses business currency %s without hardcoded pesos',
  async (currency) => {
    businessMock.mockReturnValue(business('business-a', 'OWNER', currency));
    listMock.mockReturnValue(success([{ ...service, price: 0.29 }]));
    await renderWithProviders(<ServicesScreen />);
    expect(screen.getByText(new RegExp(`${currency}.*0,29`))).toBeOnTheScreen();
    expect(screen.queryByText(/ARS/)).toBeNull();
  },
);

test.each(['idle', 'pending'] as const)(
  'business %s gates query and management actions',
  async (status) => {
    businessMock.mockReturnValue({
      status,
      data: null,
      error: null,
      isFetching: status === 'pending',
    } as BusinessContextValue);
    await renderWithProviders(<ServicesScreen />);
    expect(listMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Crear servicio' })).toBeNull();
    if (status === 'pending')
      expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
    else expect(screen.getByRole('status', { name: /Negocio no disponible/ })).toBeOnTheScreen();
  },
);

test('business error displays safe message without service query', async () => {
  businessMock.mockReturnValue({
    status: 'error',
    data: null,
    error: { code: 'NO_ACTIVE_MEMBERSHIP', message: 'No tienes un negocio disponible.' },
    isFetching: false,
  });
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('alert', { name: /No tienes un negocio disponible/ })).toBeOnTheScreen();
  expect(listMock).not.toHaveBeenCalled();
});

test('pending renders accessible loading and never a premature empty state', async () => {
  listMock.mockReturnValue(pending);
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('progressbar', { name: 'Cargando servicios…' })).toBeOnTheScreen();
  expect(screen.queryByText(/No hay servicios/)).toBeNull();
});

test('idle is unavailable rather than successful empty data', async () => {
  listMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('status', { name: 'Servicios no disponibles' })).toBeOnTheScreen();
});

test('each empty filter has distinct copy and owner retains create CTA', async () => {
  listMock.mockReturnValue(success([], 1, false));
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('status', { name: 'No hay servicios activos.' })).toBeOnTheScreen();
  await press('Archivados');
  expect(screen.getByRole('status', { name: 'No hay servicios archivados.' })).toBeOnTheScreen();
  await press('Todos');
  expect(screen.getByRole('status', { name: 'No hay servicios registrados.' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Crear servicio' })).toBeEnabled();
});

test('pagination guards page 1, increments and decrements with query params', async () => {
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await press('Anterior');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
  await press('Siguiente');
  expect(listMock).toHaveBeenLastCalledWith({ page: 2, pageSize: 25, status: 'active' });
  expect(screen.getByText('Página 2')).toBeOnTheScreen();
  await press('Anterior');
  expect(screen.getByText('Página 1')).toBeOnTheScreen();
});

test('hasNextPage false disables next regardless of rows', async () => {
  listMock.mockReturnValue(success([service], 1, false));
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await press('Siguiente');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
});

test('changing filters resets page, selected semantics and returning active', async () => {
  await renderWithProviders(<ServicesScreen />);
  await press('Siguiente');
  await press('Archivados');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'inactive' });
  expect(screen.getByRole('button', { name: 'Archivados' })).toBeSelected();
  await press('Siguiente');
  await press('Todos');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'all' });
  expect(screen.getByRole('button', { name: 'Todos' })).toBeSelected();
  await press('Activos');
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
});

test('pressing selected filter keeps its page', async () => {
  await renderWithProviders(<ServicesScreen />);
  await press('Siguiente');
  await press('Activos');
  expect(screen.getByText('Página 2')).toBeOnTheScreen();
});

test.each(['page', 'filter'])(
  'new %s pending never relabels previous rows as new results',
  async (mode) => {
    listMock.mockImplementation((params) =>
      params?.page === 1 && params.status === 'active' ? success() : pending,
    );
    await renderWithProviders(<ServicesScreen />);
    await press(mode === 'page' ? 'Siguiente' : 'Archivados');
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Editar servicio/ })).toBeNull();
    expect(screen.queryByText(/No hay servicios/)).toBeNull();
  },
);

test('safe error retries only current business/filter/page, preserving controls', async () => {
  listMock.mockImplementation((params) =>
    params?.page === 2 && params.status === 'inactive' ? failure : success([service], params?.page),
  );
  const { queryClient } = await renderWithProviders(<ServicesScreen />);
  await press('Archivados');
  await press('Siguiente');
  const params = { page: 2, pageSize: 25, status: 'inactive' as const };
  const key = servicesKeys.list('business-a', params);
  const others = [
    servicesKeys.list('business-b', params),
    servicesKeys.list('business-a', { ...params, page: 1 }),
    servicesKeys.list('business-a', { ...params, status: 'active' }),
  ];
  queryClient.setQueryData(key, 'current');
  others.forEach((other) => queryClient.setQueryData(other, 'other'));
  expect(screen.getByRole('alert', { name: /No pudimos cargar los servicios/ })).toBeOnTheScreen();
  expect(screen.queryByText(/Postgrest|JWT|stack|NETWORK_ERROR/)).toBeNull();
  await press('Reintentar');
  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  others.forEach((other) => expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false));
  expect(listMock).toHaveBeenLastCalledWith(params);
  expect(screen.getByRole('button', { name: 'Archivados' })).toBeSelected();
});

test('retry disables while current read is fetching', async () => {
  listMock.mockReturnValue({ ...failure, isFetching: true });
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
});

test('owner create and archived row navigate to future new/edit routes with exact id', async () => {
  listMock.mockReturnValue(success([{ ...service, is_active: false }]));
  await renderWithProviders(<ServicesScreen />);
  await press('Crear servicio');
  expect(routerMock.push).toHaveBeenLastCalledWith('/services/new');
  await press(/^Editar servicio Corte/);
  expect(routerMock.push).toHaveBeenLastCalledWith({
    pathname: '/services/[id]/edit',
    params: { id: 'service-a' },
  });
});

test('BARBER reads services and textual status without write affordances', async () => {
  businessMock.mockReturnValue(business('business-a', 'BARBER'));
  await renderWithProviders(<ServicesScreen />);
  expect(screen.getByLabelText('Corte, ARS 10.000,00, 30 minutos, Activo')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Crear servicio|Editar servicio/ })).toBeNull();
  expect(screen.getByText('Activo')).toBeOnTheScreen();
});

test('owner row has touch target and visible focus', async () => {
  await renderWithProviders(<ServicesScreen />);
  const row = screen.getByRole('button', { name: /^Editar servicio Corte/ });
  expect(row).toHaveStyle({ minHeight: theme.sizing.touchTarget });
  await fireEvent(row, 'focus');
  expect(row).toHaveStyle({ borderColor: theme.colors.primary });
  await fireEvent(row, 'blur');
  expect(row).toHaveStyle({ borderColor: theme.colors.border });
});

test('tenant switch resets filters/page and removes previous rows while new query is pending', async () => {
  const rendered = await renderWithProviders(<ServicesScreen />);
  await press('Todos');
  await press('Siguiente');
  businessMock.mockReturnValue(business('business-b'));
  listMock.mockReturnValue(pending);
  await rendered.rerender(<ServicesScreen />);
  expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, status: 'active' });
  expect(screen.queryByRole('button', { name: /^Editar servicio/ })).toBeNull();
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
});

test('loss of business immediately removes rows and controls', async () => {
  const rendered = await renderWithProviders(<ServicesScreen />);
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await rendered.rerender(<ServicesScreen />);
  expect(
    screen.queryByRole('button', { name: /^Editar servicio|Crear servicio|Todos/ }),
  ).toBeNull();
});

test('role downgrade removes management controls without copying server data', async () => {
  const rendered = await renderWithProviders(<ServicesScreen />);
  businessMock.mockReturnValue(business('business-a', 'BARBER'));
  await rendered.rerender(<ServicesScreen />);
  expect(screen.queryByRole('button', { name: /Crear servicio|Editar servicio/ })).toBeNull();
  expect(screen.getByText('Corte')).toBeOnTheScreen();
});

test('settings exposes the service list destination', async () => {
  await renderWithProviders(<SettingsRoute />);
  await press('Servicios');
  expect(routerMock.push).toHaveBeenLastCalledWith('/services');
});
