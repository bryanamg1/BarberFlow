import type { Session } from '@supabase/supabase-js';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';

import { AppointmentDuration } from '@/features/appointments/components/AppointmentDuration';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { servicesService } from '@/features/services/services/servicesService';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { getById: jest.fn() },
}));
jest.mock('@/features/business/services/businessSettingsService', () => ({
  businessSettingsService: { get: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Unexpected Supabase access');
});
const catalog = jest.mocked(servicesService);
const settings = jest.mocked(businessSettingsService);
const item = { serviceId: 's', quantity: 2 };
const row = (business_id = 'b', id = 's', duration_minutes = 30): ServiceRow => ({
  id,
  business_id,
  name: 'Corte',
  price: 100,
  duration_minutes,
  is_active: true,
  description: null,
  created_at: '',
  updated_at: '',
});
function context(
  businessId = 'b',
  userId = 'u',
  membershipId = 'm',
  role: 'OWNER' | 'BARBER' = 'OWNER',
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
    error: null,
    isFetching: false,
    data: {
      membershipId,
      role,
      business: {
        id: businessId,
        name: 'Demo',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
}
const settingsRow = (businessId = 'b', buffer = 10) =>
  ({
    data: {
      profile: {
        id: businessId,
        name: 'Demo',
        phone: null,
        email: null,
        address: null,
        currency_code: 'ARS',
        timezone: 'UTC',
        logo_url: null,
      },
      preferences: {
        business_id: businessId,
        appointment_interval_minutes: 15,
        default_service_buffer_minutes: buffer,
        allow_overlapping_appointments: false,
        low_stock_notifications: true,
      },
    },
    error: null,
  }) as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Controlled({ onChange = jest.fn() }: { onChange?: (value: number | undefined) => void }) {
  const [value, setValue] = useState<number>();
  return (
    <AppointmentDuration
      items={[item]}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler(defaultScheduler));
beforeEach(() => {
  context();
  catalog.getById.mockImplementation(async (businessId, id) => ({
    data: row(businessId, id),
    error: null,
  }));
  settings.get.mockImplementation(async (id) => settingsRow(id));
});
test('derived duration respects quantity and keeps posterior buffer separate without emitting', async () => {
  const change = jest.fn();
  await renderWithProviders(<Controlled onChange={change} />);
  expect(await screen.findByText('Duración del servicio: 60 minutos')).toBeTruthy();
  expect(screen.getByText('Buffer posterior: 10 minutos (separado del servicio)')).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
});
test('OWNER applies explicit valid override and resets to catalog without catalog mutation', async () => {
  const change = jest.fn();
  await renderWithProviders(<Controlled onChange={change} />);
  await screen.findByText('Duración del servicio: 60 minutos');
  fireEvent.changeText(screen.getByLabelText('Duración personalizada (minutos)'), '45');
  await userEvent.press(screen.getByRole('button', { name: 'Aplicar duración' }));
  expect(change).toHaveBeenLastCalledWith(45);
  expect(screen.getByText('Duración del servicio: 45 minutos')).toBeTruthy();
  expect(screen.getByText('Duración calculada: 60 minutos')).toBeTruthy();
  await userEvent.press(screen.getByRole('button', { name: 'Usar duración calculada' }));
  expect(change).toHaveBeenLastCalledWith(undefined);
  expect(screen.getByText('Duración del servicio: 60 minutos')).toBeTruthy();
});
test.each(['', '0', '-2', '1.5', '1e2', '2147483648', 'text'])(
  'invalid override %s is safe and not emitted',
  async (text) => {
    const change = jest.fn();
    await renderWithProviders(<Controlled onChange={change} />);
    await screen.findByText('Duración del servicio: 60 minutos');
    fireEvent.changeText(screen.getByLabelText('Duración personalizada (minutos)'), text);
    await userEvent.press(screen.getByRole('button', { name: 'Aplicar duración' }));
    expect(
      screen.getByText('Error: Ingresa un número entero positivo dentro del máximo permitido.'),
    ).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  },
);
test('BARBER reads derived duration and buffer without OWNER controls', async () => {
  context('b', 'u', 'm', 'BARBER');
  await renderWithProviders(<Controlled />);
  expect(await screen.findByText('Duración del servicio: 60 minutos')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Aplicar duración' })).toBeNull();
});
test('BARBER cannot consume a supplied OWNER override', async () => {
  context('b', 'u', 'm', 'BARBER');
  await renderWithProviders(<AppointmentDuration items={[item]} value={45} onChange={jest.fn()} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Duración del servicio: 45 minutos')).toBeNull();
});
test('no selection is empty, not zero; invalid quantity is unavailable', async () => {
  const view = await renderWithProviders(
    <AppointmentDuration items={[]} value={undefined} onChange={jest.fn()} />,
  );
  expect(screen.getByText('Selecciona servicios para calcular la duración')).toBeTruthy();
  expect(catalog.getById).not.toHaveBeenCalled();
  await view.rerender(
    <AppointmentDuration
      items={[{ ...item, quantity: 0 }]}
      value={undefined}
      onChange={jest.fn()}
    />,
  );
  expect(screen.getByRole('alert')).toBeTruthy();
});
test.each(['missing', 'foreign', 'archived', 'duration', 'settings'] as const)(
  'unsafe %s data cannot fabricate a duration',
  async (kind) => {
    if (kind === 'missing')
      catalog.getById.mockResolvedValue({
        data: null,
        error: { code: 'SERVICE_NOT_FOUND', message: 'safe' },
      });
    if (kind === 'foreign') catalog.getById.mockResolvedValue({ data: row('other'), error: null });
    if (kind === 'archived')
      catalog.getById.mockResolvedValue({ data: { ...row(), is_active: false }, error: null });
    if (kind === 'duration')
      catalog.getById.mockResolvedValue({ data: row('b', 's', 0), error: null });
    if (kind === 'settings') settings.get.mockResolvedValue(settingsRow('b', -1));
    await renderWithProviders(<Controlled />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Duración del servicio: 60 minutos')).toBeNull();
  },
);
test('unexpected rejected raw error stays private and retry recovers', async () => {
  catalog.getById.mockRejectedValueOnce(new Error('private SQL/token'));
  await renderWithProviders(<Controlled />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/private SQL/)).toBeNull();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Duración del servicio: 60 minutos')).toBeTruthy();
});
test.each(['business', 'user', 'membership'] as const)(
  '%s change hides previous data and ignores late responses',
  async (change) => {
    const old = deferred<Awaited<ReturnType<typeof servicesService.getById>>>();
    catalog.getById.mockReturnValueOnce(old.promise);
    const view = await renderWithProviders(<Controlled />);
    context(
      change === 'business' ? 'b2' : 'b',
      change === 'user' ? 'u2' : 'u',
      change === 'membership' ? 'm2' : 'm',
    );
    catalog.getById.mockImplementation(async (b, id) => ({ data: row(b, id, 20), error: null }));
    await view.rerender(<Controlled />);
    expect(await screen.findByText('Duración del servicio: 40 minutos')).toBeTruthy();
    await act(async () => old.resolve({ data: row(), error: null }));
    expect(screen.queryByText('Duración del servicio: 60 minutos')).toBeNull();
  },
);
test('selection and quantity changes use current lines, not a stale calculation', async () => {
  const view = await renderWithProviders(
    <AppointmentDuration items={[item]} value={undefined} onChange={jest.fn()} />,
  );
  await screen.findByText('Duración del servicio: 60 minutos');
  await view.rerender(
    <AppointmentDuration
      items={[{ ...item, quantity: 3 }]}
      value={undefined}
      onChange={jest.fn()}
    />,
  );
  expect(await screen.findByText('Duración del servicio: 90 minutos')).toBeTruthy();
});
test('logout hides data and clears the override from the previous context', async () => {
  const change = jest.fn();
  const view = await renderWithProviders(
    <AppointmentDuration items={[item]} value={45} onChange={change} />,
  );
  await screen.findByRole('button', { name: 'Aplicar duración' });
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
  await view.rerender(<AppointmentDuration items={[item]} value={45} onChange={change} />);
  expect(screen.getByText('Duración no disponible')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Aplicar duración' })).toBeNull();
  expect(change).toHaveBeenCalledWith(undefined);
  await view.unmount();
});

test('a response after unmount never emits an override or a duration into the parent', async () => {
  const pending = deferred<Awaited<ReturnType<typeof servicesService.getById>>>();
  catalog.getById.mockReturnValue(pending.promise);
  const change = jest.fn();
  const view = await renderWithProviders(<Controlled onChange={change} />);
  await view.unmount();
  await act(async () => pending.resolve({ data: row(), error: null }));
  expect(change).not.toHaveBeenCalled();
});
