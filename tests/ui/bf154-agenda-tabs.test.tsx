import { fireEvent, render, screen } from '@testing-library/react-native';

import { AgendaViewTabs, type AgendaView } from '@/features/appointments/components/AgendaViewTabs';

jest.mock('@/lib/supabase/client', () => {
  throw new Error('No tabs backend');
});
jest.mock('@/features/appointments/hooks/useAppointments', () => {
  throw new Error('No tabs query');
});
jest.mock('@/features/appointments/utils/agendaCalendar', () => {
  throw new Error('No tabs time calculations');
});

test('three readable view controls and current view text, no fourth view', async () => {
  await render(<AgendaViewTabs value="day" onChange={jest.fn()} />);
  expect(screen.getAllByRole('button')).toHaveLength(3);
  for (const label of ['Día', 'Semana', 'Mes'])
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  expect(screen.getByText('Vista actual: Día')).toBeTruthy();
});
test.each([
  ['day', 'Día'],
  ['week', 'Semana'],
  ['month', 'Mes'],
] as const)('controlled %s selection is accessible', async (value, label) => {
  await render(<AgendaViewTabs value={value} onChange={jest.fn()} />);
  for (const option of ['Día', 'Semana', 'Mes'])
    expect(screen.getByRole('button', { name: option }).props.accessibilityState.selected).toBe(
      option === label,
    );
});
test.each([
  ['day', 'Día'],
  ['week', 'Semana'],
  ['month', 'Mes'],
] as const)(
  'press emits exact %s value without changing controlled state',
  async (value, label) => {
    const change = jest.fn();
    await render(<AgendaViewTabs value="day" onChange={change} />);
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(change).toHaveBeenCalledWith(value);
    expect(screen.getByText('Vista actual: Día')).toBeTruthy();
  },
);
test('external controlled changes adopt the supplied value, no hidden global state', async () => {
  const change = jest.fn(),
    { rerender } = await render(<AgendaViewTabs value="day" onChange={change} />);
  for (const value of ['week', 'month', 'day'] as AgendaView[])
    await rerender(<AgendaViewTabs value={value} onChange={change} />);
  expect(screen.getByText('Vista actual: Día')).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
});
