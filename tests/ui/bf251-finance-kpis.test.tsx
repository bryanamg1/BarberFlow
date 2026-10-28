import { useState } from 'react';
import * as RN from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FinanceKpiCards } from '@/features/analytics/components/FinanceKpiCards';
import { FinancePeriodFilter } from '@/features/analytics/components/FinancePeriodFilter';
import type {
  FinanceDashboardSummary,
  FinanceKpiResult,
} from '@/features/analytics/types/finance.types';
import type { FinancePeriod } from '@/features/analytics/utils/financePeriod';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatMoney } from '@/utils/formatMoney';
import { agendaContext } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Presentation must not access SDK');
});
const data: FinanceDashboardSummary = {
  total_revenue: '123.45',
  service_revenue: '100.00',
  product_revenue: '23.45',
  expenses: '2.00',
  merchandise_purchases: '999.99',
  profit: '-0.50',
  appointments: '17',
  active_clients: '18',
  average_ticket: '1.23',
  products_sold: '19',
  cancellations: '20',
  no_shows: '21',
};
const result = (
  period: FinancePeriod = 'TODAY',
  summary: FinanceDashboardSummary = data,
): FinanceKpiResult => ({
  status: 'success',
  scope: { userId: 'u', businessId: 'b', membershipId: 'm', timezone: 'UTC', period },
  data: summary,
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

test('exact 12 canonical fields/order and authoritative values, signed subunit profit, no calculation', async () => {
  await render(<FinanceKpiCards period="TODAY" result={result()} />);
  const expected = [
    ['Ingresos totales', '123.45'],
    ['Ingresos por servicios', '100.00'],
    ['Ingresos por productos', '23.45'],
    ['Gastos manuales', '2.00'],
    ['Compras de mercadería', '999.99'],
    ['Ganancia', '-0.50'],
    ['Turnos', '17'],
    ['Clientes activos', '18'],
    ['Ticket promedio', '1.23'],
    ['Productos vendidos', '19'],
    ['Cancelaciones', '20'],
    ['Ausencias', '21'],
  ];
  const labels = expected.map(
    ([label, value], i) =>
      `${label}: ${[6, 7, 9, 10, 11].includes(i) ? value : formatMoney(value, 'ARS')}`,
  );
  for (const label of labels) expect(screen.getByLabelText(label)).toBeTruthy();
  expect(
    screen
      .getAllByLabelText(
        /^(Ingresos|Gastos|Compras|Ganancia|Turnos|Clientes|Ticket|Productos|Cancelaciones|Ausencias).*:/,
      )
      .map((node) => node.props.accessibilityLabel),
  ).toEqual(labels);
  expect(screen.queryByText('COGS')).toBeNull();
});
test('zero success stays zero, average_ticket NULL is exactly emdash', async () => {
  const zero = { ...data };
  for (const key of Object.keys(zero) as (keyof typeof zero)[])
    zero[key] = [
      'appointments',
      'active_clients',
      'products_sold',
      'cancellations',
      'no_shows',
    ].includes(key)
      ? '0'
      : '0.00';
  zero.average_ticket = null;
  await render(<FinanceKpiCards period="TODAY" result={result('TODAY', zero)} />);
  expect(screen.getByLabelText('Ticket promedio: —')).toBeTruthy();
  expect(screen.getByLabelText('Ganancia: ' + formatMoney('0.00', 'ARS'))).toBeTruthy();
});
test.each(['loading', 'error', 'unavailable'] as const)(
  '%s never presents zero/success data',
  async (status) => {
    await render(<FinanceKpiCards period="TODAY" result={{ status }} />);
    expect(screen.queryByLabelText(/^Ingresos totales:/)).toBeNull();
    expect(screen.queryByText(formatMoney('0.00', 'ARS'))).toBeNull();
    expect(
      screen.getByText(
        status === 'loading'
          ? 'Cargando resumen financiero…'
          : status === 'error'
            ? 'No pudimos cargar el resumen financiero.'
            : 'Resumen financiero no disponible',
      ),
    ).toBeTruthy();
  },
);
test.each(['BARBER', 'logout', 'recovering', 'business', 'member', 'user', 'timezone'] as const)(
  'no financial data across %s boundary',
  async (mode) => {
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'business') agendaContext({ businessId: 'new' });
    if (mode === 'member') agendaContext({ membershipId: 'new' });
    if (mode === 'user') agendaContext({ userId: 'new' });
    if (mode === 'timezone') agendaContext({ timezone: 'Asia/Tokyo' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (mode === 'recovering') {
      const auth = useAuth();
      jest
        .mocked(useAuth)
        .mockReturnValue({ ...auth, status: 'recovering' } as ReturnType<typeof useAuth>);
    }
    await render(<FinanceKpiCards period="TODAY" result={result()} />);
    expect(screen.queryByLabelText(/^Ingresos totales:/)).toBeNull();
  },
);
test('parent period changes hide former result until matching summary arrives; no mirrored period', async () => {
  function Parent() {
    const [period, setPeriod] = useState<FinancePeriod>('TODAY');
    return (
      <>
        <FinancePeriodFilter value={period} onChange={setPeriod} />
        <FinanceKpiCards period={period} result={result('TODAY')} />
      </>
    );
  }
  const view = await render(<Parent />);
  expect(screen.getByLabelText('Ingresos totales: ' + formatMoney('123.45', 'ARS'))).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Semana' }));
  expect(screen.queryByLabelText(/^Ingresos totales:/)).toBeNull();
  await view.rerender(
    <FinanceKpiCards period="WEEK" result={result('WEEK', { ...data, total_revenue: '456.78' })} />,
  );
  expect(screen.getByLabelText('Ingresos totales: ' + formatMoney('456.78', 'ARS'))).toBeTruthy();
});
test.each(['TODAY', 'WEEK', 'MONTH', 'YEAR', 'ALL_TIME'] as const)(
  'matching %s result renders unchanged',
  async (period) => {
    await render(<FinanceKpiCards period={period} result={result(period)} />);
    expect(screen.getByLabelText('Ganancia: ' + formatMoney('-0.50', 'ARS'))).toBeTruthy();
  },
);
test('large decimals/counts retain all digits and currency comes explicitly from business', async () => {
  const business = useBusiness();
  if (business.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...business,
    data: { ...business.data, business: { ...business.data.business, currency_code: 'USD' } },
  });
  await render(
    <FinanceKpiCards
      period="TODAY"
      result={result('TODAY', {
        ...data,
        total_revenue: '900719925474099312345.29',
        products_sold: '900719925474099312345',
      })}
    />,
  );
  expect(
    screen.getByLabelText('Ingresos totales: USD 900.719.925.474.099.312.345,29'),
  ).toBeTruthy();
  expect(screen.getByLabelText('Productos vendidos: 900719925474099312345')).toBeTruthy();
});
test('missing transport field cannot become success-zero', async () => {
  const partial = { ...data, total_revenue: undefined } as unknown as FinanceDashboardSummary;
  await render(<FinanceKpiCards period="TODAY" result={result('TODAY', partial)} />);
  expect(screen.getByText('Resumen financiero no disponible')).toBeTruthy();
  expect(screen.queryByText('Ganancia')).toBeNull();
});
test.each([375, 768, 1400])(
  'cards render accessible values at width %s without desktop-only layout',
  async (width) => {
    jest
      .mocked(RN.useWindowDimensions)
      .mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    await render(<FinanceKpiCards period="TODAY" result={result()} />);
    const card = screen.getByLabelText('Turnos: 17');
    const style = RN.StyleSheet.flatten(card.props.style);
    expect(style.flexBasis).toBe(width >= 768 ? '40%' : undefined);
    expect(screen.getByLabelText('Ticket promedio: ' + formatMoney('1.23', 'ARS'))).toBeTruthy();
  },
);

test('positive profit is displayed as supplied without clamping or recalculation', async () => {
  await render(
    <FinanceKpiCards period="TODAY" result={result('TODAY', { ...data, profit: '12.34' })} />,
  );
  expect(screen.getByLabelText('Ganancia: ' + formatMoney('12.34', 'ARS'))).toBeTruthy();
});

test.each([
  ['Hoy', 'TODAY', '1.00'],
  ['Semana', 'WEEK', '2.00'],
  ['Mes', 'MONTH', '3.00'],
  ['Año', 'YEAR', '4.00'],
  ['Todo el historial', 'ALL_TIME', '5.00'],
] as const)(
  'parent supplies the authoritative %s summary after selection',
  async (label, selected, amount) => {
    const amounts = { TODAY: '1.00', WEEK: '2.00', MONTH: '3.00', YEAR: '4.00', ALL_TIME: '5.00' };
    function Parent() {
      const [period, setPeriod] = useState<FinancePeriod>('TODAY');
      return (
        <>
          <FinancePeriodFilter value={period} onChange={setPeriod} />
          <FinanceKpiCards
            period={period}
            result={result(period, { ...data, total_revenue: amounts[period] })}
          />
        </>
      );
    }
    await render(<Parent />);
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(screen.getByLabelText('Ingresos totales: ' + formatMoney(amount, 'ARS'))).toBeTruthy();
    expect(screen.getByText('Período actual: ' + label)).toBeTruthy();
    expect(selected).toBeDefined();
  },
);
