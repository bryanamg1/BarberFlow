import * as RN from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { HomeFinanceSummary } from '@/features/analytics/components/HomeFinanceSummary';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatMoney } from '@/utils/formatMoney';
import { agendaContext } from './helpers/agendaFixture';
import { financeSummary } from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => {
  throw new Error('No Router in presentational component');
});
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

test('OWNER sees exact heading, revenue/profit order and callback CTA, without extra metrics', async () => {
  const onOpen = jest.fn();
  await render(
    <HomeFinanceSummary
      result={{ status: 'success', data: financeSummary() }}
      onOpenFinances={onOpen}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Resumen financiero' })).toBeTruthy();
  expect(screen.getAllByRole('group').map((v) => v.props.accessibilityLabel)).toEqual([
    'Ingresos: ' + formatMoney('100.00', 'ARS'),
    'Ganancia: ' + formatMoney('-0.50', 'ARS'),
  ]);
  const labels = screen
    .getAllByText(/^(Resumen financiero|Ingresos|Ganancia|Ver finanzas)$/, {
      includeHiddenElements: true,
    })
    .map((v) => v.props.children);
  expect(labels).toEqual(['Resumen financiero', 'Ingresos', 'Ganancia', 'Ver finanzas']);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Ver finanzas' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledWith();
});

test.each(['loading', 'error', 'unavailable'] as const)(
  '%s uses feedback, hides CTA and does not fabricate zero',
  async (status) => {
    await render(<HomeFinanceSummary result={{ status }} onOpenFinances={jest.fn()} />);
    expect(
      screen.getByText(
        status === 'loading'
          ? 'Cargando resumen financiero…'
          : status === 'error'
            ? 'No pudimos cargar el resumen financiero.'
            : 'Resumen financiero no disponible',
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Ver finanzas' })).toBeNull();
  },
);

test.each(['12.34', '0.00', '-12.34', '-0.50', '-900719925474099312345.29'])(
  'profit %s is rendered exactly, without clamp or recomputation',
  async (profit) => {
    await render(
      <HomeFinanceSummary
        result={{ status: 'success', data: { ...financeSummary(), profit } }}
        onOpenFinances={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Ganancia: ' + formatMoney(profit, 'ARS'))).toBeTruthy();
  },
);

test('zero revenue and profit remain successful values with CTA', async () => {
  await render(
    <HomeFinanceSummary
      result={{
        status: 'success',
        data: { ...financeSummary(), total_revenue: '0.00', profit: '0.00' },
      }}
      onOpenFinances={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Ingresos: ' + formatMoney('0.00', 'ARS'))).toBeTruthy();
  expect(screen.getByLabelText('Ganancia: ' + formatMoney('0.00', 'ARS'))).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ver finanzas' })).toBeTruthy();
  expect(screen.queryByText('—')).toBeNull();
});

test.each([
  'Turnos',
  'Clientes activos',
  'Gastos',
  'Compras de mercadería',
  'Ingresos por servicios',
  'Ingresos por productos',
  'Ticket promedio',
])('does not render %s', async (label) => {
  await render(
    <HomeFinanceSummary
      result={{ status: 'success', data: financeSummary() }}
      onOpenFinances={jest.fn()}
    />,
  );
  expect(screen.queryByText(label)).toBeNull();
});

test.each(['BARBER', 'logout', 'recovering', 'business', 'revalidating'])(
  '%s cannot display success or a financial CTA',
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
    await render(
      <HomeFinanceSummary
        result={{ status: 'success', data: financeSummary() }}
        onOpenFinances={jest.fn()}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Resumen financiero' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver finanzas' })).toBeNull();
  },
);

test.each([375, 768, 1400])(
  'width %s preserves semantic order and signed accessible text',
  async (width) => {
    jest
      .mocked(RN.useWindowDimensions)
      .mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    await render(
      <HomeFinanceSummary
        result={{ status: 'success', data: financeSummary() }}
        onOpenFinances={jest.fn()}
      />,
    );
    expect(screen.getAllByRole('group').map((v) => v.props.accessibilityLabel)).toEqual([
      'Ingresos: ' + formatMoney('100.00', 'ARS'),
      'Ganancia: ' + formatMoney('-0.50', 'ARS'),
    ]);
  },
);

test('uses current business currency for both supplied values', async () => {
  const b = useBusiness();
  if (b.status !== 'success') throw Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...b,
    data: { ...b.data, business: { ...b.data.business, currency_code: 'USD' } },
  });
  await render(
    <HomeFinanceSummary
      result={{ status: 'success', data: financeSummary() }}
      onOpenFinances={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Ingresos: ' + formatMoney('100.00', 'USD'))).toBeTruthy();
  expect(screen.getByLabelText('Ganancia: ' + formatMoney('-0.50', 'USD'))).toBeTruthy();
});
