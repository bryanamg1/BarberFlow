import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FinancePeriodFilter } from '@/features/analytics/components/FinancePeriodFilter';
import {
  DEFAULT_FINANCE_PERIOD,
  type FinancePeriod,
} from '@/features/analytics/utils/financePeriod';

jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK in presentation');
});

test('five exact accessible options; provided selection controls rendering and emits intent only', async () => {
  const onChange = jest.fn();
  const result = await render(<FinancePeriodFilter value="MONTH" onChange={onChange} />);
  expect(screen.getAllByRole('button')).toHaveLength(5);
  for (const name of ['Hoy', 'Semana', 'Mes', 'Año', 'Todo el historial'])
    expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mes', selected: true })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Semana' }));
  expect(onChange).toHaveBeenCalledWith('WEEK');
  expect(screen.getByRole('button', { name: 'Mes', selected: true })).toBeTruthy();
  await result.rerender(<FinancePeriodFilter value="WEEK" onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Semana', selected: true })).toBeTruthy();
  expect(screen.queryByText('CUSTOM')).toBeNull();
});

test('parent retains period across mounted tab changes; remount starts parent TODAY, no durable store', async () => {
  function Parent() {
    const [value, setValue] = useState<FinancePeriod>(DEFAULT_FINANCE_PERIOD);
    const [tab, setTab] = useState(false);
    return (
      <>
        <FinancePeriodFilter value={value} onChange={setValue} />
        <FinancePeriodFilter value={tab ? 'WEEK' : 'TODAY'} onChange={() => setTab((v) => !v)} />
      </>
    );
  }
  const view = await render(<Parent />);
  await fireEvent.press(screen.getAllByRole('button', { name: 'Año' })[0]);
  await fireEvent.press(screen.getAllByRole('button', { name: 'Semana' })[1]);
  expect(screen.getByText('Período actual: Año')).toBeTruthy();
  await view.unmount();
  await render(<FinancePeriodFilter value="TODAY" onChange={jest.fn()} />);
  expect(screen.getByText('Período actual: Hoy')).toBeTruthy();
});

test('Web forwards pressed semantics and wrapping to existing Button primitive', () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const element = FinancePeriodFilter({ value: 'ALL_TIME', onChange: jest.fn() });
  const group = element.props.children[0];
  expect(
    group.props.children.map(
      (button: React.ReactElement<{ 'aria-pressed': boolean }>) => button.props['aria-pressed'],
    ),
  ).toEqual([false, false, false, false, true]);
  expect(StyleSheet.flatten(group.props.style).flexWrap).toBe('wrap');
  expect(StyleSheet.flatten(element.props.style).maxWidth).toBe(1200);
});
