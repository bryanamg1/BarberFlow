import { useState } from 'react';
import * as RN from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FinanceRevenueChart } from '@/features/analytics/components/FinanceRevenueChart';
import type { FinanceRevenuePoint } from '@/features/analytics/types/finance.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { agendaContext } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK in chart presentation');
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));
const point = (
  date: string,
  service_revenue = '25.00',
  product_revenue = '75.00',
  total_revenue = '100.00',
): FinanceRevenuePoint => ({ date, service_revenue, product_revenue, total_revenue });
beforeEach(() => {
  agendaContext();
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width: 375, height: 800, scale: 1, fontScale: 1 });
});

test('two exact legend series in order, authoritative accessible date/Services/Products/Total and no total stack', async () => {
  await render(<FinanceRevenueChart points={[point('2026-10-01')]} />);
  expect(
    screen
      .getByLabelText('Series de ingresos')
      .props.children.map((n: React.ReactElement<{ children: string }>) => n.props.children),
  ).toEqual(['Servicios', 'Productos']);
  expect(
    screen.getByLabelText(
      /jueves, 1 de octubre de 2026.*Servicios: ARS.*25,00.*Productos: ARS.*75,00.*Total: ARS.*100,00/,
    ),
  ).toBeTruthy();
  const bar = screen.container
    .queryAll(() => true)
    .find((n) => RN.StyleSheet.flatten(n.props.style)?.flexDirection === 'column-reverse');
  expect(bar).toBeDefined();
  expect(bar!.props.children).toHaveLength(2);
  expect(
    bar!.props.children.map(
      (n: React.ReactElement<{ style: RN.StyleProp<RN.ViewStyle> }>) =>
        RN.StyleSheet.flatten(n.props.style).height,
    ),
  ).toEqual([48, 144]);
});
test('one column per date, producer order, zero day and service/product-only values retained', async () => {
  await render(
    <FinanceRevenueChart
      points={[
        point('2026-10-01', '0.00', '0.00', '0.00'),
        point('2026-10-02', '1.00', '0.00', '1.00'),
        point('2026-10-03', '0.00', '2.00', '2.00'),
      ]}
    />,
  );
  expect(
    screen
      .getAllByLabelText(/de octubre de 2026.*Servicios:/)
      .map((n) => n.props.accessibilityLabel),
  ).toEqual([
    expect.stringMatching(/jueves, 1.*Total: ARS.*0,00/),
    expect.stringMatching(/viernes, 2.*Servicios: ARS.*1,00/),
    expect.stringMatching(/sábado, 3.*Productos: ARS.*2,00/),
  ]);
  expect(screen.getAllByText(/0[123]\/10/, { includeHiddenElements: true })).toHaveLength(3);
});
test('all zero renders dates/data and zero-height segments; empty alone uses EmptyState', async () => {
  const view = await render(
    <FinanceRevenueChart points={[point('2026-10-01', '0.00', '0.00', '0.00')]} />,
  );
  const bars = screen.container
    .queryAll(() => true)
    .filter((n) => RN.StyleSheet.flatten(n.props.style)?.flexDirection === 'column-reverse');
  expect(
    bars[0].props.children.map(
      (n: React.ReactElement<{ style: RN.StyleProp<RN.ViewStyle> }>) =>
        RN.StyleSheet.flatten(n.props.style).height,
    ),
  ).toEqual([0, 0]);
  expect(screen.getByLabelText(/Total: ARS.*0,00/)).toBeTruthy();
  await view.rerender(<FinanceRevenueChart points={[]} />);
  expect(screen.getByText('Sin ingresos en este período')).toBeTruthy();
  expect(screen.queryByText('Ingresos por día')).toBeNull();
});
test('malformed source never becomes empty or fabricated zero', async () => {
  await render(<FinanceRevenueChart points={[point('2026-02-30')]} />);
  expect(screen.getByText('Gráfico de ingresos no disponible')).toBeTruthy();
  expect(screen.queryByText('Sin ingresos en este período')).toBeNull();
});
test('ALL_TIME complete, horizontally scrollable with no cap or sampling', async () => {
  const points = Array.from({ length: 100 }, (_, i) =>
    point(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)),
  );
  await render(<FinanceRevenueChart points={points} />);
  expect(screen.getAllByLabelText(/Servicios: ARS.*Productos: ARS.*Total:/)).toHaveLength(100);
  const scroll = screen.getByLabelText(
    'Gráfico de ingresos por fecha, con desplazamiento horizontal',
  );
  expect(scroll.props.horizontal).toBe(true);
  const row = scroll.queryAll(
    (node) =>
      RN.StyleSheet.flatten(node.props.style)?.flexDirection === 'row' &&
      typeof RN.StyleSheet.flatten(node.props.style)?.width === 'number',
  )[0];
  expect(RN.StyleSheet.flatten(row.props.style).width).toBe(6400);
});
test('explicit current business currency and exact huge text remain independent of geometry', async () => {
  const b = useBusiness();
  if (b.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...b,
    data: { ...b.data, business: { ...b.data.business, currency_code: 'USD' } },
  });
  await render(
    <FinanceRevenueChart
      points={[point('2026-10-01', '900719925474099312345.29', '0.00', '900719925474099312345.29')]}
    />,
  );
  expect(
    screen.getByLabelText(
      /Servicios: USD\s900\.719\.925\.474\.099\.312\.345,29.*Total: USD\s900\.719\.925\.474\.099\.312\.345,29/,
    ),
  ).toBeTruthy();
});
test.each([
  'BARBER',
  'logout',
  'recovering',
  'business-unavailable',
  'membership-revalidation',
] as const)('Finance data hidden for %s', async (mode) => {
  if (mode === 'BARBER') agendaContext({ role: 'BARBER' });
  if (mode === 'logout')
    jest
      .mocked(useAuth)
      .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  if (mode === 'recovering')
    jest
      .mocked(useAuth)
      .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
  if (mode === 'business-unavailable')
    jest
      .mocked(useBusiness)
      .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
  if (mode === 'membership-revalidation')
    jest
      .mocked(useBusiness)
      .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
  await render(<FinanceRevenueChart points={[point('2026-10-01')]} />);
  expect(screen.queryByText('Ingresos por día')).toBeNull();
  expect(screen.queryByLabelText(/Total: ARS/)).toBeNull();
});
test.each([375, 768, 1400])(
  'available-width layout at %s with canonical cap and no fixed desktop canvas',
  async (width) => {
    jest
      .mocked(RN.useWindowDimensions)
      .mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    await render(<FinanceRevenueChart points={[point('2026-10-01')]} />);
    const bar = screen.container
      .queryAll(() => true)
      .find((n) => RN.StyleSheet.flatten(n.props.style)?.flexDirection === 'column-reverse');
    expect(RN.StyleSheet.flatten(bar!.props.style).height).toBe(width >= 768 ? 240 : 192);
    const layout = screen.container.queryAll(() => true).find((n) => n.props.onLayout);
    await fireEvent(layout!, 'layout', {
      nativeEvent: { layout: { width: width >= 1200 ? 1100 : width - 64 } },
    });
    const row = screen
      .getByLabelText('Gráfico de ingresos por fecha, con desplazamiento horizontal')
      .queryAll(
        (node) =>
          RN.StyleSheet.flatten(node.props.style)?.flexDirection === 'row' &&
          typeof RN.StyleSheet.flatten(node.props.style)?.width === 'number',
      )[0];
    expect(RN.StyleSheet.flatten(row.props.style).width).toBe(width >= 1200 ? 1100 : width - 64);
  },
);
test('existing parent owns loading/error/unavailable and passes [] only for genuine success-empty', async () => {
  function Parent() {
    const [status, setStatus] = useState('loading');
    return status === 'loading' ? (
      <RN.Pressable
        accessibilityRole="button"
        accessibilityLabel="Resolver"
        onPress={() => setStatus('error')}
      >
        <LoadingState message="Cargando ingresos" />
      </RN.Pressable>
    ) : status === 'error' ? (
      <ErrorState message="Error de ingresos" onRetry={() => setStatus('unavailable')} />
    ) : status === 'unavailable' ? (
      <RN.Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver a consultar"
        onPress={() => setStatus('success')}
      >
        <EmptyState title="Ingresos no disponibles" />
      </RN.Pressable>
    ) : (
      <FinanceRevenueChart points={[]} />
    );
  }
  await render(<Parent />);
  expect(screen.getByText('Cargando ingresos')).toBeTruthy();
  expect(screen.queryByText('Sin ingresos en este período')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Resolver' }));
  expect(screen.getByText('Error de ingresos')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(screen.getByText('Ingresos no disponibles')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Volver a consultar' }));
  expect(screen.getByText('Sin ingresos en este período')).toBeTruthy();
});
