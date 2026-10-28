import * as RN from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { FinanceServicesPanel } from '@/features/analytics/components/FinanceServicesPanel';
import type {
  FinanceServiceRow,
  FinanceServicesResult,
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

const service = (extra: Partial<FinanceServiceRow> = {}): FinanceServiceRow => ({
  service_id: 'historical-service',
  name: 'Corte histórico',
  quantity: '2',
  net_revenue: '1234.50',
  ...extra,
});
const success = (data: readonly FinanceServiceRow[] = [service()]): FinanceServicesResult => ({
  status: 'success',
  data,
});
const hiddenText = { includeHiddenElements: true };
beforeEach(() => {
  agendaContext();
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width: 375, height: 800, scale: 1, fontScale: 1 });
});

test.each([
  ['loading', 'Cargando servicios…'],
  ['error', 'No pudimos cargar los servicios.'],
  ['unavailable', 'Servicios financieros no disponibles'],
] as const)('%s is distinct from successful empty data', async (status, message) => {
  await render(<FinanceServicesPanel result={{ status }} />);
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText('Sin servicios con ventas en este período')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
test('only successful [] is empty; real zero renders all three fields', async () => {
  const view = await render(<FinanceServicesPanel result={success([])} />);
  expect(screen.getByText('Sin servicios con ventas en este período')).toBeTruthy();
  await view.rerender(
    <FinanceServicesPanel result={success([service({ quantity: '0', net_revenue: '0.00' })])} />,
  );
  expect(
    screen.getByRole('group', { name: /Corte histórico.*Cantidad: 0.*Ingresos netos: ARS\s0,00/ }),
  ).toBeTruthy();
  for (const text of ['Servicio', 'Cantidad', 'Ingresos netos', 'Corte histórico', '0'])
    expect(screen.getByText(text, hiddenText)).toBeTruthy();
});
test('exact visible labels, original historical name and hidden identity; original immutable input', async () => {
  const row = Object.freeze(service({ name: '  Nombre histórico original  ' }));
  await render(<FinanceServicesPanel result={success(Object.freeze([row]))} />);
  expect(
    screen.getByRole('group', {
      name: /Nombre histórico original.*Cantidad: 2.*Ingresos netos: ARS\s1\.234,50/,
    }),
  ).toBeTruthy();
  expect(screen.getByText('  Nombre histórico original  ', hiddenText)).toBeTruthy();
  expect(screen.queryByText(row.service_id, hiddenText)).toBeNull();
  expect(screen.queryByText(/service_id|net_revenue/, hiddenText)).toBeNull();
  expect(screen.getAllByRole('group')).toHaveLength(1);
});
test('producer order and all rows retained; no name/quantity/revenue rerank or top-five cap', async () => {
  const rows = Object.freeze(
    Array.from({ length: 12 }, (_, i) =>
      Object.freeze(
        service({
          service_id: `id-${i}`,
          name: `Nombre ${12 - i}`,
          quantity: String(i),
          net_revenue: `${i}.00`,
        }),
      ),
    ),
  );
  await render(<FinanceServicesPanel result={success(rows)} />);
  expect(
    screen.getAllByRole('group').map((n) => n.props.accessibilityLabel.split('. Cantidad')[0]),
  ).toEqual(rows.map((r) => r.name));
});
test('large quantity and money remain exact strings in explicit current business currency', async () => {
  const b = useBusiness();
  if (b.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...b,
    data: { ...b.data, business: { ...b.data.business, currency_code: 'USD' } },
  });
  await render(
    <FinanceServicesPanel
      result={success([
        service({ quantity: '900719925474099312345', net_revenue: '900719925474099312345.29' }),
      ])}
    />,
  );
  expect(
    screen.getByRole('group', {
      name: /Cantidad: 900719925474099312345.*USD\s900\.719\.925\.474\.099\.312\.345,29/,
    }),
  ).toBeTruthy();
});
test.each([
  { service_id: '' },
  { service_id: '  ' },
  { name: '' },
  { name: ' \t' },
  { quantity: '-1' },
  { quantity: '1.0' },
  { quantity: 'NaN' },
  { net_revenue: '-0.01' },
  { net_revenue: '1.1' },
  { net_revenue: 'NaN' },
])('malformed row %j is unavailable, not fabricated zero/empty', async (extra) => {
  await render(<FinanceServicesPanel result={success([service(extra)])} />);
  expect(screen.getByText('Servicios financieros no disponibles')).toBeTruthy();
  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.queryByText('Sin servicios con ventas en este período')).toBeNull();
});
test('duplicate identity and malformed transport arrays never partially render', async () => {
  const view = await render(<FinanceServicesPanel result={success([service(), service()])} />);
  expect(screen.queryByRole('group')).toBeNull();
  await view.rerender(
    <FinanceServicesPanel
      result={{ status: 'success', data: null } as unknown as FinanceServicesResult}
    />,
  );
  expect(screen.getByText('Servicios financieros no disponibles')).toBeTruthy();
});
test.each(['BARBER', 'logout', 'recovering', 'business-pending', 'revalidating'] as const)(
  'hides Finance data in %s context',
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
    if (mode === 'business-pending')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
    if (mode === 'revalidating')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
    await render(<FinanceServicesPanel result={success()} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText('Servicios financieros no disponibles')).toBeTruthy();
  },
);
test.each([375, 768, 1400])(
  'responsive ranking at %s and a single accessible entity per row',
  async (width) => {
    jest
      .mocked(RN.useWindowDimensions)
      .mockReturnValue({ width, height: 800, scale: 1, fontScale: 2 });
    await render(<FinanceServicesPanel result={success()} />);
    const row = screen.getByRole('group');
    expect(RN.StyleSheet.flatten(row.props.style).flexDirection).toBe(
      width >= 768 ? 'row' : undefined,
    );
    expect(
      screen.container.queryAll((n) => RN.StyleSheet.flatten(n.props.style)?.maxWidth === 1200)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Corte histórico')).toBeNull();
    expect(screen.getByText('Corte histórico', hiddenText)).toBeTruthy();
  },
);

// Compile-time public boundary: no extra context props and no numeric quantity.
const approvedProps: React.ComponentProps<typeof FinanceServicesPanel> = { result: success() };
void approvedProps;
const invalidProps: React.ComponentProps<typeof FinanceServicesPanel> = {
  result: success(),
  // @ts-expect-error BF256 owns period, not the panel props.
  period: 'TODAY',
};
void invalidProps;
// @ts-expect-error quantity is a lossless string, never a JS number.
const invalidQuantity: FinanceServiceRow = { ...service(), quantity: 2 };
void invalidQuantity;
