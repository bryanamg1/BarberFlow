import type { Session } from '@supabase/supabase-js';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AppointmentDateField } from '@/features/appointments/components/AppointmentDateField';
import { AppointmentDuration } from '@/features/appointments/components/AppointmentDuration';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import { servicesService } from '@/features/services/services/servicesService';
import { renderWithProviders } from '@/test/renderWithProviders';
import { theme } from '@/theme';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { getById: jest.fn() },
}));
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: { get: jest.fn() },
}));
jest.mock('@/features/appointments/services/appointmentsService', () => {
  throw new Error('Date field must not request availability or create an appointment');
});
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Date field must not access Supabase');
});
function context(
  businessId = 'b',
  userId = 'u',
  membershipId = 'm',
  timezone = 'America/Argentina/Buenos_Aires',
) {
  const session: Session = {
    access_token: 'test',
    refresh_token: 'test',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  };
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'authenticated', user: session.user, session, error: null });
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role: 'OWNER',
      business: { id: businessId, name: 'Demo', currency_code: 'ARS', timezone, is_active: true },
    },
  });
}
const label = 'Fecha del turno (YYYY-MM-DD)';
function Controlled({
  initial = '',
  onChange = jest.fn(),
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AppointmentDateField
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}
beforeEach(() => context());
test.each(['2026-10-21', '2024-02-29', '0001-01-01', '9999-12-31', '1900-01-01'])(
  'renders %s exactly without UTC/default-date output',
  async (value) => {
    const change = jest.fn();
    await render(<AppointmentDateField value={value} onChange={change} />);
    expect(screen.getByLabelText(label).props.value).toBe(value);
    expect(screen.queryByText(/^Error:/)).toBeNull();
    expect(change).not.toHaveBeenCalled();
  },
);
test.each([
  '2025-02-29',
  '1900-02-29',
  '2026-13-01',
  '2026-04-31',
  '26-01-01',
  '0000-01-01',
  '10000-01-01',
])('invalid %s has safe feedback without rewriting text', async (value) => {
  await render(<AppointmentDateField value={value} onChange={jest.fn()} />);
  expect(screen.getByLabelText(label).props.value).toBe(value);
  expect(
    screen.getByText(
      'Error: Ingresa una fecha real en formato YYYY-MM-DD, entre los años 0001 y 9999.',
    ),
  ).toBeTruthy();
});
test('controlled edits retain partial/original text; parent and schema own final submission', async () => {
  const change = jest.fn();
  await render(<Controlled onChange={change} />);
  for (const text of ['2026-', '2026-02-29', '2024-02-29', ' 2024-02-29 ', '']) {
    await fireEvent.changeText(screen.getByLabelText(label), text);
    expect(change).toHaveBeenLastCalledWith(text);
    expect(screen.getByLabelText(label).props.value).toBe(text);
  }
  await fireEvent(screen.getByLabelText(label), 'blur');
  expect(screen.getByText(/^Error:/)).toBeTruthy();
});
test('business timezone is displayed without consulting or converting device time', async () => {
  const before = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';
  try {
    await render(<Controlled initial="2026-11-01" />);
    expect(
      screen.getByText('Zona horaria del negocio: America/Argentina/Buenos_Aires'),
    ).toBeTruthy();
    expect(screen.getByLabelText(label).props.value).toBe('2026-11-01');
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
test.each(['business', 'user', 'membership', 'timezone'] as const)(
  '%s change remounts the field and prevents the old handler emitting',
  async (kind) => {
    const change = jest.fn();
    const view = await render(<AppointmentDateField value="2026-03-08" onChange={change} />);
    const oldInput = screen.getByLabelText(label);
    const late = oldInput.props.onChangeText;
    context(
      kind === 'business' ? 'b2' : 'b',
      kind === 'user' ? 'u2' : 'u',
      kind === 'membership' ? 'm2' : 'm',
      kind === 'timezone' ? 'America/New_York' : 'America/Argentina/Buenos_Aires',
    );
    await view.rerender(<AppointmentDateField value="2026-03-08" onChange={change} />);
    expect(screen.getByLabelText(label).props.value).toBe('2026-03-08');
    expect(change).not.toHaveBeenCalled();
    await act(async () => late('2027-01-01'));
    expect(change).not.toHaveBeenCalled();
  },
);
test('logout/unmount removes the field and ignores late input', async () => {
  const change = jest.fn();
  const view = await render(<AppointmentDateField value="2026-03-08" onChange={change} />);
  const late = screen.getByLabelText(label).props.onChangeText;
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  await view.rerender(<AppointmentDateField value="2026-03-08" onChange={change} />);
  expect(screen.queryByLabelText(label)).toBeNull();
  await view.unmount();
  await act(async () => late('2027-01-01'));
  expect(change).not.toHaveBeenCalled();
});
test('missing or invalid timezone is unavailable without falling back to device timezone', async () => {
  context('b', 'u', 'm', 'invalid/private-zone');
  await render(<Controlled initial="2026-01-01" />);
  expect(screen.queryByLabelText(label)).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/invalid\/private-zone/)).toBeNull();
});
test('shared Input keeps accessible label, Inter and touch size without date limits', async () => {
  await render(<Controlled />);
  const input = screen.getByLabelText(label);
  const style = StyleSheet.flatten(input.props.style);
  expect(style.fontFamily).toBe(theme.typography.bodyLg.fontFamily);
  expect(style.minHeight).toBe(theme.sizing.touchTarget);
  expect(input.props.maxLength).toBeUndefined();
  expect(input.props.min).toBeUndefined();
  expect(input.props.max).toBeUndefined();
  expect(input.props.autoCorrect).toBe(false);
});
test('coexists with BF162 without creating a slot, instant or mutation', async () => {
  const dateChange = jest.fn(),
    durationChange = jest.fn();
  await renderWithProviders(
    <>
      <AppointmentDateField value="2024-02-29" onChange={dateChange} />
      <AppointmentDuration items={[]} value={undefined} onChange={durationChange} />
    </>,
  );
  expect(screen.getByLabelText(label).props.value).toBe('2024-02-29');
  expect(screen.getByText('Selecciona servicios para calcular la duración')).toBeTruthy();
  expect(jest.mocked(servicesService).getById).not.toHaveBeenCalled();
  expect(jest.mocked(businessSettingsService).get).not.toHaveBeenCalled();
  expect(dateChange).not.toHaveBeenCalled();
  expect(durationChange).not.toHaveBeenCalled();
});
