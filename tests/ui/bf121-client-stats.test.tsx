import { screen, userEvent } from '@testing-library/react-native';

import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { ClientStats } from '@/features/clients/components/ClientStats';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import { useClientDetail } from '@/features/clients/hooks/useClientDetail';
import { useClientStats } from '@/features/clients/hooks/useClientStats';
import { ClientDetailScreen } from '@/features/clients/screens/ClientDetailScreen';
import type {
  ClientStats as Stats,
  UseClientStatsResult,
} from '@/features/clients/types/clientStats.types';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientDetail', () => ({ useClientDetail: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientStats', () => ({ useClientStats: jest.fn() }));

const businessMock = jest.mocked(useBusiness);
const statsMock = jest.mocked(useClientStats);
const detailMock = jest.mocked(useClientDetail);
const business = (role: 'OWNER' | 'BARBER' = 'OWNER', currency = 'ARS'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm',
    role,
    business: {
      id: 'b',
      name: 'B',
      currency_code: currency,
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
});
const data: Stats = {
  totalAppointments: '17',
  completedVisits: '10',
  noShowCount: '2',
  lastVisitAt: '2026-01-01T00:00:00Z',
  nextAppointmentAt: '2026-02-01T12:00:00Z',
  totalSpent: '9007199254740993.29',
};
const success = (overrides: Partial<Stats> = {}): UseClientStatsResult => ({
  status: 'success',
  data: { ...data, ...overrides },
  error: null,
  isFetching: false,
});
const client = {
  id: 'c',
  business_id: 'b',
  first_name: 'Martín',
  last_name: 'Pérez',
  phone: null,
  email: null,
  instagram: null,
  birth_date: null,
  notes: null,
  preferences: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
beforeEach(() => {
  businessMock.mockReturnValue(business());
  jest.mocked(useAuth).mockReturnValue({ status: 'authenticated', user: { id: 'u' } } as AuthState);
  statsMock.mockReturnValue(success());
  detailMock.mockReturnValue({ status: 'success', data: client, error: null, isFetching: false });
});

test('OWNER detail integrates all six accessible metrics in compact approved order', async () => {
  await renderWithProviders(<ClientDetailScreen clientId=" Original-ID " />);
  expect(statsMock).toHaveBeenLastCalledWith(' Original-ID ');
  expect(screen.getByRole('heading', { name: 'Martín Pérez' })).toBeOnTheScreen();
  expect(screen.getByRole('heading', { name: 'Estadísticas del cliente' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Total de citas registradas: 17')).toBeOnTheScreen();
  expect(screen.getByLabelText('Visitas completadas: 10')).toBeOnTheScreen();
  expect(screen.getByLabelText('Ausencias: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText(/Última visita: 31.*dic.*2025.*21:00/)).toBeOnTheScreen();
  expect(screen.getByLabelText(/Próximo turno: 1.*feb.*2026.*09:00/)).toBeOnTheScreen();
  expect(
    screen.getByLabelText(/Total gastado: ARS.*9\.007\.199\.254\.740\.993,29/),
  ).toBeOnTheScreen();
});

test.each([null, '9007199254740993.29'])(
  'BARBER hides finance with no restricted placeholder even with anomalous cached amount %s',
  async (totalSpent) => {
    businessMock.mockReturnValue(business('BARBER'));
    statsMock.mockReturnValue(success({ totalSpent }));
    await renderWithProviders(<ClientStats clientId="c" />);
    for (const label of [
      'Próximo turno',
      'Última visita',
      'Visitas completadas',
      'Ausencias',
      'Total de citas registradas',
    ]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.queryByText('Total gastado')).toBeNull();
    expect(screen.queryByText(/9\.007/)).toBeNull();
    expect(screen.queryByText(/restringid|Sin datos/)).toBeNull();
  },
);

test('OWNER zero activity is successful, with explicit absent dates and visible currency zero', async () => {
  businessMock.mockReturnValue(business('OWNER', 'USD'));
  statsMock.mockReturnValue(
    success({
      totalAppointments: '0',
      completedVisits: '0',
      noShowCount: '0',
      lastVisitAt: null,
      nextAppointmentAt: null,
      totalSpent: '0.00',
    }),
  );
  await renderWithProviders(<ClientStats clientId="c" />);
  expect(screen.getByLabelText('Total de citas registradas: 0')).toBeOnTheScreen();
  expect(screen.getByLabelText('Visitas completadas: 0')).toBeOnTheScreen();
  expect(screen.getByLabelText('Ausencias: 0')).toBeOnTheScreen();
  expect(screen.getByLabelText('Última visita: Sin visitas completadas')).toBeOnTheScreen();
  expect(screen.getByLabelText('Próximo turno: Sin próximo turno')).toBeOnTheScreen();
  expect(screen.getByLabelText(/Total gastado: USD.*0,00/)).toBeOnTheScreen();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test('stats pending keeps client information and edit action usable', async () => {
  statsMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  await renderWithProviders(<ClientDetailScreen clientId="c" />);
  expect(screen.getByRole('heading', { name: 'Martín Pérez' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Editar cliente' })).toBeEnabled();
  expect(screen.getByRole('progressbar', { name: 'Cargando estadísticas…' })).toBeOnTheScreen();
});

test('stats error is isolated, no stale amount, exact scoped retry only', async () => {
  statsMock.mockReturnValue({
    status: 'error',
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'No se pudo conectar con el servicio.' },
    isFetching: false,
  });
  const { queryClient } = await renderWithProviders(<ClientDetailScreen clientId="c" />);
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  expect(screen.getByRole('heading', { name: 'Martín Pérez' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Editar cliente' })).toBeEnabled();
  expect(screen.getByRole('alert', { name: /Estadísticas no disponibles/ })).toBeOnTheScreen();
  expect(screen.queryByText('Total gastado')).toBeNull();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: clientsKeys.stats('b', 'c', 'u', 'OWNER'),
    exact: true,
  });
});

test('archived client retains stats', async () => {
  detailMock.mockReturnValue({
    status: 'success',
    data: { ...client, is_active: false },
    error: null,
    isFetching: false,
  });
  await renderWithProviders(<ClientDetailScreen clientId="c" />);
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  expect(screen.getByLabelText('Visitas completadas: 10')).toBeOnTheScreen();
});

test('missing detail never mounts or fetches stats', async () => {
  detailMock.mockReturnValue({
    status: 'error',
    data: null,
    error: { code: 'CLIENT_NOT_FOUND', message: 'No se encontró el cliente.' },
    isFetching: false,
  });
  await renderWithProviders(<ClientDetailScreen clientId="c" />);
  expect(statsMock).not.toHaveBeenCalled();
});

test('idle stats render no misleading values or financial placeholder', async () => {
  statsMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await renderWithProviders(<ClientStats clientId={null} />);
  expect(screen.queryByText('Total gastado')).toBeNull();
  expect(screen.queryByRole('heading')).toBeNull();
});
