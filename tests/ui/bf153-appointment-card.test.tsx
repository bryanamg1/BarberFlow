import { fireEvent, render, screen } from '@testing-library/react-native';

import { AppointmentCard } from '@/features/appointments/components/AppointmentCard';
import { agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No card Supabase');
});
jest.mock('@/features/appointments/hooks/useAppointments', () => {
  throw new Error('No card query');
});
jest.mock('@/features/appointments/services/appointmentsService', () => {
  throw new Error('No card service');
});

const onPress = jest.fn();
test.each([
  ['PENDING', 'Pendiente'],
  ['CONFIRMED', 'Confirmada'],
  ['IN_PROGRESS', 'En curso'],
  ['COMPLETED', 'Completada'],
  ['CANCELLED', 'Cancelada'],
  ['NO_SHOW', 'No asistió'],
] as const)(
  'renders %s with accessible text, without filtering terminal appointments',
  async (status, label) => {
    await render(
      <AppointmentCard
        appointment={agendaRow('id', undefined, undefined, { status })}
        timezone="UTC"
        onPress={onPress}
      />,
    );
    expect(screen.getByRole('button', { name: new RegExp(`^Turno,.*${label}`) })).toBeTruthy();
  },
);

test('real timestamps are formatted in supplied business timezone without changing the frozen row', async () => {
  const row = Object.freeze(agendaRow('kept', '2026-10-02T01:00:00Z', '2026-10-02T02:00:00Z'));
  await render(
    <AppointmentCard
      appointment={row}
      timezone="America/Argentina/Buenos_Aires"
      onPress={() => onPress(row.id)}
    />,
  );
  const button = screen.getByRole('button', { name: /^Turno,/ });
  expect(button.props.accessibilityLabel).toContain('22:00');
  expect(button.props.accessibilityLabel).toContain('23:00');
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledWith('kept');
  expect(row.id).toBe('kept');
  expect(row.start_at).toBe('2026-10-02T01:00:00Z');
  expect(row.end_at).toBe('2026-10-02T02:00:00Z');
});
test('supplied authorized client/barber/service labels are displayed and combined accessibly', async () => {
  await render(
    <AppointmentCard
      appointment={agendaRow()}
      timezone="UTC"
      clientLabel="Martín Pérez"
      barberLabel="Ana"
      serviceSummary="Corte clásico × 2"
      onPress={onPress}
    />,
  );
  const button = screen.getByRole('button', { name: /Martín Pérez, Ana, Corte clásico × 2/ });
  expect(button.props.accessibilityLabel).toContain('Pendiente');
  expect(screen.getByText(/Martín Pérez\s+Ana\s+Corte clásico × 2/)).toBeTruthy();
});
test('missing optional labels and null links do not invent names, IDs or force a query', async () => {
  const row = agendaRow('private-id', undefined, undefined, {
    client_id: 'hidden-client',
    barber_member_id: 'hidden-member',
  });
  await render(
    <AppointmentCard
      appointment={row}
      timezone="UTC"
      clientLabel={null}
      barberLabel=" "
      serviceSummary={null}
      onPress={onPress}
    />,
  );
  const label = screen.getByRole('button', { name: /^Turno,/ }).props.accessibilityLabel;
  expect(label).not.toMatch(/hidden-client|hidden-member|private-id|undefined|null/);
});
test('static card without callback is one named text entity and has no active button', async () => {
  await render(<AppointmentCard appointment={agendaRow()} timezone="UTC" />);
  expect(screen.getByRole('text', { name: /^Turno,/ })).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
test('previous-day continuation is textual and preserves the real original range', async () => {
  const row = Object.freeze(agendaRow());
  await render(
    <AppointmentCard
      appointment={row}
      timezone="UTC"
      segment={{ continued: true }}
      onPress={onPress}
    />,
  );
  const button = screen.getByRole('button', { name: /^Turno, Continúa/ });
  expect(button.props.accessibilityLabel).toContain('23:30');
  expect(button.props.accessibilityLabel).toContain('00:30');
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(row.id).toBe('a');
});
test('normal entry ending next day shows both real dates rather than changing its start/end', async () => {
  await render(<AppointmentCard appointment={agendaRow()} timezone="UTC" onPress={onPress} />);
  const label = screen.getByRole('button', { name: /^Turno,/ }).props.accessibilityLabel;
  expect(label).toContain('1/10/26');
  expect(label).toContain('2/10/26');
  expect(label).not.toContain('Continúa');
});
test('compact and default variants preserve identical identity/selection/status content', async () => {
  const props = { appointment: agendaRow(), timezone: 'UTC', onPress };
  const { rerender } = await render(<AppointmentCard {...props} />);
  const label = screen.getByRole('button').props.accessibilityLabel;
  await rerender(<AppointmentCard {...props} variant="compact" />);
  expect(screen.getByRole('button').props.accessibilityLabel).toBe(label);
  await fireEvent.press(screen.getByRole('button'));
  expect(onPress).toHaveBeenCalledTimes(1);
});
test('long already-loaded strings remain complete and are never trimmed destructively', async () => {
  const name = '  Cliente con nombre extenso '.repeat(12);
  await render(
    <AppointmentCard
      appointment={agendaRow()}
      timezone="UTC"
      clientLabel={name}
      onPress={onPress}
    />,
  );
  expect(screen.getByRole('button').props.accessibilityLabel).toContain(name);
});
