import * as RN from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { FinanceProductsExpensesPanel } from '@/features/analytics/components/FinanceProductsExpensesPanel';
import { FinanceServicesPanel } from '@/features/analytics/components/FinanceServicesPanel';
import type {
  FinanceProductRow,
  FinanceProductsResult,
  FinanceExpenseSummary,
  FinanceExpensesResult,
} from '@/features/analytics/types/finance.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { agendaContext } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK in Finance panels');
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const product = (extra: Partial<FinanceProductRow> = {}): FinanceProductRow => ({
  product_id: 'historical-product',
  name: 'Cera histórica',
  quantity: '2',
  net_revenue: '100.00',
  cogs: '60.00',
  gross_profit: '40.00',
  ...extra,
});
const products = (data: readonly FinanceProductRow[] = [product()]): FinanceProductsResult => ({
  status: 'success',
  data,
});
const summary = (extra: Partial<FinanceExpenseSummary> = {}): FinanceExpenseSummary => ({
  manual_total: '10.00',
  purchase_total: '20.00',
  total: '30.00',
  by_category: [],
  ...extra,
});
const expenses = (extra: Partial<FinanceExpenseSummary> = {}): FinanceExpensesResult => ({
  status: 'success',
  data: summary(extra),
});
const zero: FinanceExpensesResult = expenses({
  manual_total: '0.00',
  purchase_total: '0.00',
  total: '0.00',
});
const hiddenText = { includeHiddenElements: true };
beforeEach(() => {
  agendaContext();
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width: 375, height: 800, scale: 1, fontScale: 1 });
});

test.each([
  ['loading', 'Cargando productos…'],
  ['error', 'No pudimos cargar los productos.'],
  ['unavailable', 'Productos financieros no disponibles'],
] as const)('products %s keeps successful expense totals visible', async (status, message) => {
  await render(
    <FinanceProductsExpensesPanel productsResult={{ status }} expensesResult={expenses()} />,
  );
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.getByRole('group', { name: /Gastos manuales: ARS\s10,00/ })).toBeTruthy();
  expect(screen.queryByText('Sin productos vendidos en este período')).toBeNull();
});
test.each([
  ['loading', 'Cargando gastos…'],
  ['error', 'No pudimos cargar los gastos.'],
  ['unavailable', 'Gastos financieros no disponibles'],
] as const)('expenses %s keeps successful products visible', async (status, message) => {
  await render(
    <FinanceProductsExpensesPanel productsResult={products()} expensesResult={{ status }} />,
  );
  expect(screen.getByText(message)).toBeTruthy();
  expect(
    screen.getByRole('group', { name: /Producto: Cera histórica.*Cantidad: 2.*Costo: ARS\s60,00/ }),
  ).toBeTruthy();
});
test('product success-empty plus zero expenses is empty only for products', async () => {
  await render(
    <FinanceProductsExpensesPanel productsResult={products([])} expensesResult={zero} />,
  );
  expect(screen.getByText('Sin productos vendidos en este período')).toBeTruthy();
  expect(screen.getAllByRole('group', { name: /: ARS\s0,00/ })).toHaveLength(3);
  expect(screen.queryByText('Desglose por categoría')).toBeNull();
});
test('exact product fields and labels, original snapshots and hidden identity, accessible without duplicate children', async () => {
  const row = Object.freeze(product({ name: '  Cera histórica original  ' }));
  await render(
    <FinanceProductsExpensesPanel
      productsResult={products(Object.freeze([row]))}
      expensesResult={expenses()}
    />,
  );
  expect(
    screen.getByRole('group', {
      name: /Producto:.*Cera histórica original.*Cantidad: 2.*Ingresos netos: ARS\s100,00.*Costo: ARS\s60,00.*Ganancia bruta: ARS\s40,00/,
    }),
  ).toBeTruthy();
  for (const label of ['Producto', 'Cantidad', 'Ingresos netos', 'Costo', 'Ganancia bruta'])
    expect(screen.getByText(label, hiddenText)).toBeTruthy();
  expect(screen.getByText('  Cera histórica original  ', hiddenText)).toBeTruthy();
  expect(screen.queryByText(row.product_id, hiddenText)).toBeNull();
  expect(screen.queryByText('Cera histórica')).toBeNull();
});
test.each(['40.00', '-40.00', '-0.50'])(
  'authoritative signed gross profit %s preserved without recalculation',
  async (gross_profit) => {
    await render(
      <FinanceProductsExpensesPanel
        productsResult={products([product({ gross_profit })])}
        expensesResult={zero}
      />,
    );
    expect(
      screen.getByRole('group', {
        name:
          gross_profit === '-0.50'
            ? /Ganancia bruta: -ARS\s0,50/
            : gross_profit.startsWith('-')
              ? /Ganancia bruta: -ARS\s40,00/
              : /Ganancia bruta: ARS\s40,00/,
      }),
    ).toBeTruthy();
  },
);
test('large quantity/money, explicit USD, exact two decimals and negative amounts', async () => {
  const b = useBusiness();
  if (b.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...b,
    data: { ...b.data, business: { ...b.data.business, currency_code: 'USD' } },
  });
  await render(
    <FinanceProductsExpensesPanel
      productsResult={products([
        product({
          quantity: '900719925474099312345',
          net_revenue: '900719925474099312345.29',
          cogs: '900719925474099312345.79',
          gross_profit: '-0.50',
        }),
      ])}
      expensesResult={expenses({ total: '900719925474099312345.29' })}
    />,
  );
  expect(
    screen.getByRole('group', {
      name: /Cantidad: 900719925474099312345.*USD\s900\.719\.925\.474\.099\.312\.345,29.*Costo: USD\s900\.719\.925\.474\.099\.312\.345,79.*Ganancia bruta: -USD\s0,50/,
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole('group', {
      name: /Total de egresos: USD\s900\.719\.925\.474\.099\.312\.345,29/,
    }),
  ).toBeTruthy();
});
test('producer ranking/name/quantity order and all twelve rows retained', async () => {
  const rows = Object.freeze(
    Array.from({ length: 12 }, (_, i) =>
      Object.freeze(
        product({
          product_id: `id-${i}`,
          name: `Producto ${12 - i}`,
          quantity: String(i),
          net_revenue: `${i}.00`,
        }),
      ),
    ),
  );
  await render(
    <FinanceProductsExpensesPanel productsResult={products(rows)} expensesResult={zero} />,
  );
  expect(
    screen
      .getAllByRole('group', { name: /^Producto:/ })
      .map((n) => n.props.accessibilityLabel.split('. Cantidad')[0]),
  ).toEqual(rows.map((r) => `Producto: ${r.name}`));
});
test('D04 exact manual/purchase/total mapping; categories secondary, no category-name lookup', async () => {
  await render(
    <FinanceProductsExpensesPanel
      productsResult={products()}
      expensesResult={expenses({
        by_category: [
          { category_id: '00000000-0000-4000-8000-000000000001', amount: '10.00' },
          { category_id: null, amount: '20.00' },
        ],
      })}
    />,
  );
  for (const [label, amount] of [
    ['Gastos manuales', '10,00'],
    ['Compras de mercadería', '20,00'],
    ['Total de egresos', '30,00'],
  ])
    expect(
      screen.getByRole('group', { name: new RegExp(`${label}: ARS\\s${amount}`) }),
    ).toBeTruthy();
  expect(
    screen.getByRole('group', {
      name: /Categoría 00000000-0000-4000-8000-000000000001: ARS\s10,00/,
    }),
  ).toBeTruthy();
  expect(screen.getByRole('group', { name: /Sin categoría: ARS\s20,00/ })).toBeTruthy();
  expect(screen.getAllByRole('heading').map((n) => n.props.children)).toEqual([
    'Productos',
    'Gastos',
    'Desglose por categoría',
  ]);
});
test.each([
  { product_id: '' },
  { name: ' \t' },
  { quantity: '-1' },
  { quantity: '2.0' },
  { net_revenue: 'NaN' },
  { net_revenue: '-1.00' },
  { cogs: '1.001' },
  { cogs: '-1.00' },
  { gross_profit: 'Infinity' },
])('malformed product %j only makes Products unavailable', async (extra) => {
  await render(
    <FinanceProductsExpensesPanel
      productsResult={products([product(extra)])}
      expensesResult={expenses()}
    />,
  );
  expect(screen.getByText('Productos financieros no disponibles')).toBeTruthy();
  expect(screen.getByRole('group', { name: /Total de egresos: ARS\s30,00/ })).toBeTruthy();
});
test.each([
  { manual_total: 'NaN' },
  { purchase_total: '-1.00' },
  { total: '1.001' },
  { by_category: null },
  { by_category: [{ category_id: 123, amount: '1.00' }] },
  { by_category: [{ category_id: null, amount: '-1.00' }] },
])('malformed expenses %j only makes Expenses unavailable', async (extra) => {
  await render(
    <FinanceProductsExpensesPanel
      productsResult={products()}
      expensesResult={
        { status: 'success', data: { ...summary(), ...extra } } as unknown as FinanceExpensesResult
      }
    />,
  );
  expect(screen.getByText('Gastos financieros no disponibles')).toBeTruthy();
  expect(screen.getByRole('group', { name: /^Producto: Cera histórica/ })).toBeTruthy();
});
test.each(['BARBER', 'logout', 'recovering', 'business-pending', 'revalidating'] as const)(
  'context %s hides both financial sections',
  async (mode) => {
    if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (mode === 'recovering')
      jest
        .mocked(useAuth)
        .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
    if (mode === 'business-pending')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
    if (mode === 'revalidating')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
    await render(
      <FinanceProductsExpensesPanel productsResult={products()} expensesResult={expenses()} />,
    );
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText('Panel financiero no disponible')).toBeTruthy();
  },
);
test.each([375, 768, 1400])('responsive independent sections at %s', async (width) => {
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width, height: 800, scale: 1, fontScale: 2 });
  await render(
    <FinanceProductsExpensesPanel productsResult={products()} expensesResult={expenses()} />,
  );
  expect(
    RN.StyleSheet.flatten(screen.getByRole('group', { name: /^Producto:/ }).props.style)
      .flexDirection,
  ).toBe(width >= 768 ? 'row' : undefined);
  expect(
    screen.container.queryAll((n) => RN.StyleSheet.flatten(n.props.style)?.maxWidth === 1200)
      .length,
  ).toBeGreaterThan(0);
});
test('combined services/products/expenses presentation respects authoritative values and state changes', async () => {
  const view = await render(
    <RN.View>
      <FinanceServicesPanel
        result={{
          status: 'success',
          data: [{ service_id: 's', name: 'Corte', quantity: '1', net_revenue: '50.00' }],
        }}
      />
      <FinanceProductsExpensesPanel productsResult={products()} expensesResult={expenses()} />
    </RN.View>,
  );
  expect(screen.getByRole('group', { name: /Corte.*Ingresos netos: ARS\s50,00/ })).toBeTruthy();
  expect(screen.getByRole('group', { name: /^Producto: Cera histórica/ })).toBeTruthy();
  await view.rerender(
    <FinanceProductsExpensesPanel productsResult={{ status: 'error' }} expensesResult={zero} />,
  );
  expect(screen.getByText('No pudimos cargar los productos.')).toBeTruthy();
  expect(screen.getAllByRole('group', { name: /: ARS\s0,00/ })).toHaveLength(3);
});

const typedProps: React.ComponentProps<typeof FinanceProductsExpensesPanel> = {
  productsResult: products(),
  expensesResult: zero,
};
void typedProps;
const invalidProps: React.ComponentProps<typeof FinanceProductsExpensesPanel> = {
  ...typedProps,
  // @ts-expect-error BF256 owns query limit, not this presentation component.
  limit: 10,
};
void invalidProps;
