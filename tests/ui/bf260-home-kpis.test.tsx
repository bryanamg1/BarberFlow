import * as RN from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { HomeKpis } from '@/features/analytics/components/HomeKpis';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatMoney } from '@/utils/formatMoney';
import { agendaContext } from './helpers/agendaFixture';
import { financeSummary } from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK in presentation');
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));
beforeEach(() => {
  agendaContext();
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width: 375, height: 800, scale: 1, fontScale: 1 });
});

test('exact three accessible cards/order use original summary fields, not the Today list', async () => {
  const data = {
    ...financeSummary(),
    appointments: '900719925474099312345',
    active_clients: '9876543210987654321',
  };
  await render(<HomeKpis result={{ status: 'success', data }} />);
  expect(screen.getAllByRole('group').map((v) => v.props.accessibilityLabel)).toEqual([
    'Ingresos de hoy: ' + formatMoney('100.00', 'ARS'),
    'Turnos de hoy: 900719925474099312345',
    'Clientes activos: 9876543210987654321',
  ]);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test.each(['loading', 'error', 'unavailable'] as const)(
  '%s uses shared feedback without fabricated zeros',
  async (status) => {
    await render(<HomeKpis result={{ status }} />);
    expect(
      screen.getByText(
        status === 'loading'
          ? 'Cargando indicadores…'
          : status === 'error'
            ? 'No pudimos cargar los indicadores.'
            : 'Indicadores no disponibles',
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  },
);

test('valid zero values are success, not null/empty indicators', async () => {
  await render(
    <HomeKpis
      result={{
        status: 'success',
        data: {
          ...financeSummary(),
          total_revenue: '0.00',
          appointments: '0',
          active_clients: '0',
        },
      }}
    />,
  );
  expect(screen.getByLabelText('Ingresos de hoy: ' + formatMoney('0.00', 'ARS'))).toBeTruthy();
  expect(screen.getByLabelText('Turnos de hoy: 0')).toBeTruthy();
  expect(screen.getByLabelText('Clientes activos: 0')).toBeTruthy();
  expect(screen.queryByText('—')).toBeNull();
});

test.each([
  'Ganancia',
  'Gastos',
  'Ingresos por productos',
  'Ingresos por servicios',
  'Productos vendidos',
  'Cancelaciones',
  'Ausencias',
  'Ticket promedio',
  'Compras de mercadería',
  'Stock bajo',
])('does not add %s', async (label) => {
  await render(<HomeKpis result={{ status: 'success', data: financeSummary() }} />);
  expect(screen.queryByText(label)).toBeNull();
});

test.each(['BARBER', 'logout', 'recovering', 'business', 'revalidating'])(
  '%s hides financial presentation even with injected success',
  async (mode) => {
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (mode === 'recovering')
      jest
        .mocked(useAuth)
        .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
    if (mode === 'business')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
    if (mode === 'revalidating')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
    await render(<HomeKpis result={{ status: 'success', data: financeSummary() }} />);
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  },
);

test.each([375, 768, 1400])(
  'mobile-first cards preserve semantic order at width %s',
  async (width) => {
    jest
      .mocked(RN.useWindowDimensions)
      .mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    await render(<HomeKpis result={{ status: 'success', data: financeSummary() }} />);
    const cards = screen.getAllByRole('group');
    expect(cards).toHaveLength(3);
    expect(RN.StyleSheet.flatten(cards[0].props.style).flexBasis).toBe(
      width >= 768 ? '30%' : undefined,
    );
  },
);

test('currency is the current business currency and large decimals stay exact', async () => {
  const b = useBusiness();
  if (b.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...b,
    data: { ...b.data, business: { ...b.data.business, currency_code: 'USD' } },
  });
  await render(
    <HomeKpis
      result={{
        status: 'success',
        data: { ...financeSummary(), total_revenue: '900719925474099312345.29' },
      }}
    />,
  );
  expect(screen.getByLabelText('Ingresos de hoy: USD 900.719.925.474.099.312.345,29')).toBeTruthy();
});
