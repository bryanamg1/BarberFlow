import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AppointmentNotesField } from '@/features/appointments/components/AppointmentNotesField';
import { theme } from '@/theme';

// A presentational field must remain importable without data/mutation infrastructure.
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Notes field imported Supabase');
});
jest.mock('@/features/appointments/repositories/appointmentsRepository', () => {
  throw new Error('Notes field imported repository');
});
jest.mock('@/features/appointments/services/appointmentsService', () => {
  throw new Error('Notes field imported service');
});

test.each([
  'Nota existente',
  null,
  '',
  'Élodie ✂️ 𐐨',
  '  espacios   internos  ',
  'Primera\nSegunda\n',
])('renders %j without emitting changes', async (value) => {
  const onChange = jest.fn();
  await render(<AppointmentNotesField value={value} onChange={onChange} />);
  expect(screen.getByLabelText('Notas').props.value).toBe(value ?? '');
  expect(onChange).not.toHaveBeenCalled();
});
test.each(['Nuevo texto', '  sin trim  ', 'Línea 1\nLínea 2\n', 'ÁÉí ñ 👨‍👩‍👧‍👦', ''])(
  'emits exact string %j only on editing',
  async (value) => {
    const onChange = jest.fn();
    await render(<AppointmentNotesField value="Original" onChange={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('Notas'), value);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(value);
    expect(screen.getByLabelText('Notas').props.value).toBe('Original');
  },
);
test('null display never becomes an external empty value until the user edits', async () => {
  const onChange = jest.fn();
  const view = await render(<AppointmentNotesField value={null} onChange={onChange} />);
  await view.rerender(<AppointmentNotesField value="" onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  await view.rerender(<AppointmentNotesField value={null} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Notas'), '');
  expect(onChange).toHaveBeenCalledWith('');
  expect(onChange).not.toHaveBeenCalledWith(null);
});
test('parent rerenders replace the visual value and callback without retaining a draft', async () => {
  const first = jest.fn(),
    second = jest.fn();
  const view = await render(<AppointmentNotesField value="A" onChange={first} />);
  await fireEvent.changeText(screen.getByLabelText('Notas'), 'B');
  expect(screen.getByLabelText('Notas').props.value).toBe('A');
  await view.rerender(<AppointmentNotesField value=" C " onChange={second} />);
  expect(screen.getByLabelText('Notas').props.value).toBe(' C ');
  await fireEvent.changeText(screen.getByLabelText('Notas'), 'D');
  expect(second).toHaveBeenCalledWith('D');
  expect(first).toHaveBeenCalledTimes(1);
});
test('shared accessible multiline Input retains approved theme and no arbitrary length/line restriction', async () => {
  await render(<AppointmentNotesField value="Texto" onChange={jest.fn()} />);
  const field = screen.getByLabelText('Notas');
  expect(field.props.accessible).toBe(true);
  expect(field.props.multiline).toBe(true);
  expect(field.props.editable).toBe(true);
  expect(field.props.maxLength).toBeUndefined();
  expect(field.props.numberOfLines).toBeUndefined();
  expect(field.props.onSubmitEditing).toBeUndefined();
  const style = StyleSheet.flatten(field.props.style);
  expect(style.fontFamily).toBe(theme.typography.bodyLg.fontFamily);
  expect(style.color).toBe(theme.colors.textPrimary);
  expect(style.minHeight).toBe(theme.sizing.touchTarget);
  expect(screen.getAllByLabelText('Notas')).toHaveLength(1);
});
