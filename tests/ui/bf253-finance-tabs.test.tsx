import { useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  FINANCE_TABS,
  DEFAULT_FINANCE_TAB,
  FinanceTabs,
  type FinanceTab,
} from '@/features/analytics/components/FinanceTabs';
import { FinancePeriodFilter } from '@/features/analytics/components/FinancePeriodFilter';
import { FinanceRevenueChart } from '@/features/analytics/components/FinanceRevenueChart';
import {
  type FinancePeriod,
  DEFAULT_FINANCE_PERIOD,
} from '@/features/analytics/utils/financePeriod';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { agendaContext } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK in controlled Finance components');
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 375, height: 800, scale: 1, fontScale: 1 })),
}));
const labels = ['Resumen', 'Servicios', 'Productos', 'Gastos'];
beforeEach(() => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 375, height: 800, scale: 1, fontScale: 1 });
});

test('exact four public values/order, parent initial overview and readable labels', async () => {
  expect(FINANCE_TABS).toEqual(['overview', 'services', 'products', 'expenses']);
  expect(DEFAULT_FINANCE_TAB).toBe('overview');
  await render(<FinanceTabs value={DEFAULT_FINANCE_TAB} onChange={jest.fn()} />);
  expect(screen.getAllByRole('button').map((n) => n.props.accessibilityLabel)).toEqual(labels);
  expect(screen.getByRole('button', { name: 'Resumen', selected: true })).toBeTruthy();
  expect(screen.getByLabelText('Sección de Finanzas')).toBeTruthy();
});
test.each(FINANCE_TABS)(
  'provided %s controls selection; click emits only intent until parent updates',
  async (value) => {
    const onChange = jest.fn(),
      view = await render(<FinanceTabs value={value} onChange={onChange} />);
    const index = FINANCE_TABS.indexOf(value);
    expect(screen.getByRole('button', { name: labels[index], selected: true })).toBeTruthy();
    const next = (index + 1) % 4;
    await fireEvent.press(screen.getByRole('button', { name: labels[next] }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(FINANCE_TABS[next]);
    expect(screen.getByRole('button', { name: labels[index], selected: true })).toBeTruthy();
    await view.rerender(<FinanceTabs value={FINANCE_TABS[next]} onChange={onChange} />);
    expect(screen.getByRole('button', { name: labels[next], selected: true })).toBeTruthy();
  },
);
test('parent initialization, period retention across all tabs, chart coexistence and lifetime without persistence', async () => {
  agendaContext();
  function Parent() {
    const [tab, setTab] = useState<FinanceTab>(DEFAULT_FINANCE_TAB);
    const [period, setPeriod] = useState<FinancePeriod>(DEFAULT_FINANCE_PERIOD);
    return (
      <>
        <FinancePeriodFilter value={period} onChange={setPeriod} />
        <FinanceTabs value={tab} onChange={setTab} />
        <FinanceRevenueChart
          points={[
            {
              date: '2026-10-01',
              service_revenue: '1.00',
              product_revenue: '2.00',
              total_revenue: '3.00',
            },
          ]}
        />
      </>
    );
  }
  const view = await render(<Parent />);
  expect(screen.getByText('Sección actual: Resumen')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Año' }));
  for (const label of labels) {
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(screen.getByText('Período actual: Año')).toBeTruthy();
    expect(screen.getByText('Sección actual: ' + label)).toBeTruthy();
    expect(screen.getByLabelText(/Total: ARS.*3,00/)).toBeTruthy();
  }
  await view.unmount();
  await render(<Parent />);
  expect(screen.getByText('Sección actual: Resumen')).toBeTruthy();
  expect(screen.getByText('Período actual: Hoy')).toBeTruthy();
});
test('controlled selector does not render panels, chart, queries, routes or a local overview default', async () => {
  await render(<FinanceTabs value="expenses" onChange={jest.fn()} />);
  expect(screen.getByText('Sección actual: Gastos')).toBeTruthy();
  expect(screen.queryByText('Ingresos por día')).toBeNull();
  expect(screen.queryByText('Ingresos totales')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(4);
});
test('Web reuses existing pressed-button semantics, wrapping and canonical cap without local state', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const onChange = jest.fn(),
    element = FinanceTabs({ value: 'products', onChange });
  const group = element.props.children[0];
  expect(group.props.role).toBe('group');
  expect(
    group.props.children.map(
      (button: React.ReactElement<{ 'aria-pressed': boolean }>) => button.props['aria-pressed'],
    ),
  ).toEqual([false, false, true, false]);
  expect(StyleSheet.flatten(group.props.style).flexWrap).toBe('wrap');
  expect(StyleSheet.flatten(element.props.style).maxWidth).toBe(1200);
});
test('Finance host guards OWNER context; selector cannot authorize data or fetch on its own', async () => {
  agendaContext({ role: 'BARBER' });
  function Host() {
    const auth = useAuth(),
      business = useBusiness();
    return auth.status === 'authenticated' &&
      business.status === 'success' &&
      business.data.role === 'OWNER' ? (
      <FinanceTabs value="overview" onChange={jest.fn()} />
    ) : null;
  }
  const view = await render(<Host />);
  expect(screen.queryByText('Resumen')).toBeNull();
  agendaContext();
  await view.rerender(<Host />);
  expect(screen.getByRole('button', { name: 'Resumen', selected: true })).toBeTruthy();
});
