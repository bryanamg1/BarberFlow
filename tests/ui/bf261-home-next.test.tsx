import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  QueryClientProvider,
  notifyManager,
  defaultScheduler,
  onlineManager,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { HomeNextAppointment } from '@/features/analytics/components/HomeNextAppointment';
import { useNextAppointment } from '@/features/analytics/hooks/useNextAppointment';
import { homeService } from '@/features/analytics/services/homeService';
import type { HomeNextAppointmentResult } from '@/features/analytics/types/home.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/features/analytics/services/homeService', () => ({
  homeService: { getNextAppointment: jest.fn() },
}));
const service = jest.mocked(homeService.getNextAppointment);
const item = () =>
  agendaRow('appointment-secret-id', '2030-01-02T12:00:00Z', '2030-01-02T13:00:00Z', {
    notes: 'hidden private notes',
    client_id: 'hidden-client',
    created_by: 'hidden-actor',
  });
const success = (): HomeNextAppointmentResult => ({ status: 'success', data: item() });
beforeEach(() => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  jest.mocked(useIsFocused).mockReturnValue(true);
  notifyManager.setScheduler(queueMicrotask);
  onlineManager.setOnline(true);
  service.mockResolvedValue({ data: item(), error: null });
});
afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  onlineManager.setOnline(true);
});

describe('HomeNextAppointment presentation', () => {
  test.each([
    ['loading', 'Cargando próximo turno…'],
    ['error', 'No pudimos cargar el próximo turno.'],
    ['unavailable', 'Próximo turno no disponible'],
  ] as const)('%s feedback hides CTA and never queries', async (status, label) => {
    const ui = await render(<HomeNextAppointment result={{ status }} onOpen={jest.fn()} />);
    expect(ui.getByText(label)).toBeTruthy();
    expect(ui.queryByRole('button', { name: 'Ver detalle' })).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });
  test('genuine null shows canonical empty, not unavailable/error or CTA', async () => {
    const ui = await render(
      <HomeNextAppointment result={{ status: 'success', data: null }} onOpen={jest.fn()} />,
    );
    expect(ui.getByText('No hay próximos turnos')).toBeTruthy();
    expect(ui.queryByText('Próximo turno no disponible')).toBeNull();
    expect(ui.queryByRole('button')).toBeNull();
  });
  test.each([
    ['PENDING', 'Pendiente'],
    ['CONFIRMED', 'Confirmado'],
  ] as const)('%s uses approved badge text and ordered date/range/CTA', async (status, label) => {
    const ui = await render(
      <HomeNextAppointment
        result={{ status: 'success', data: { ...item(), status } }}
        onOpen={jest.fn()}
      />,
    );
    expect(ui.getByRole('heading', { name: 'Próximo turno' })).toBeTruthy();
    expect(ui.getByText('miércoles, 2 de enero de 2030')).toBeTruthy();
    expect(ui.getByText(/09:00.*10:00/)).toBeTruthy();
    expect(ui.getByText(label)).toBeTruthy();
    const text = JSON.stringify(ui.toJSON());
    expect(text.indexOf('Próximo turno')).toBeLessThan(text.indexOf('miércoles'));
    expect(text.indexOf('miércoles')).toBeLessThan(text.indexOf('09:00'));
    expect(text.indexOf('09:00')).toBeLessThan(text.indexOf(label));
    expect(text.indexOf(label)).toBeLessThan(text.indexOf('Ver detalle'));
  });
  test('CTA sends exact ID only; notes, IDs and audit are never rendered', async () => {
    const onOpen = jest.fn();
    const ui = await render(<HomeNextAppointment result={success()} onOpen={onOpen} />);
    await fireEvent.press(ui.getByRole('button', { name: 'Ver detalle' }));
    expect(onOpen).toHaveBeenCalledWith('appointment-secret-id');
    expect(onOpen).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(ui.toJSON());
    for (const hidden of [
      'appointment-secret-id',
      'hidden-client',
      'hidden-actor',
      'hidden private notes',
      'created_at',
      'business_id',
      'barber_member_id',
    ])
      expect(text).not.toContain(hidden);
  });
  test('cross-day range preserves both actual endpoints and one card in business timezone', async () => {
    const data = agendaRow('cross', '2030-01-02T02:00:00Z', '2030-01-02T04:00:00Z');
    const ui = await render(
      <HomeNextAppointment result={{ status: 'success', data }} onOpen={jest.fn()} />,
    );
    expect(ui.getByText('martes, 1 de enero de 2030')).toBeTruthy();
    expect(ui.getByText(/23:00.*01:00/)).toBeTruthy();
    expect(ui.getAllByRole('heading')).toHaveLength(1);
  });
  test('DST fall-back shows authoritative real endpoints without deriving fixed duration', async () => {
    agendaContext({ timezone: 'America/New_York' });
    const ui = await render(
      <HomeNextAppointment
        result={{
          status: 'success',
          data: agendaRow('dst', '2026-11-01T05:30:00Z', '2026-11-01T06:45:00Z'),
        }}
        onOpen={jest.fn()}
      />,
    );
    expect(ui.getByText(/01:30.*01:45/)).toBeTruthy();
  });
  test.each([
    { start_at: 'broken' },
    { end_at: 'broken' },
    { end_at: '2030-01-02T12:00:00Z' },
    { end_at: '2030-01-02T11:00:00Z' },
    { status: 'IN_PROGRESS' },
    { business_id: 'foreign' },
    { id: '' },
  ])('corrupt/mismatched result maps unavailable without CTA: %j', async (patch) => {
    const data = { ...item(), ...patch } as ReturnType<typeof item>;
    const ui = await render(
      <HomeNextAppointment result={{ status: 'success', data }} onOpen={jest.fn()} />,
    );
    expect(ui.getByText('Próximo turno no disponible')).toBeTruthy();
    expect(ui.queryByRole('button')).toBeNull();
  });
  test('unavailable auth never exposes captured data', async () => {
    jest
      .mocked(useAuth)
      .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    const ui = await render(<HomeNextAppointment result={success()} onOpen={jest.fn()} />);
    expect(ui.queryByRole('button')).toBeNull();
    expect(ui.getByText('Próximo turno no disponible')).toBeTruthy();
  });
  test('BARBER can display only own membership row', async () => {
    agendaContext({ role: 'BARBER' });
    const ui = await render(<HomeNextAppointment result={success()} onOpen={jest.fn()} />);
    expect(ui.getByRole('button')).toBeTruthy();
    agendaContext({ role: 'BARBER', membershipId: 'other' });
    await ui.rerender(<HomeNextAppointment result={success()} onOpen={jest.fn()} />);
    expect(ui.queryByRole('button')).toBeNull();
  });
  test.each([375, 1440])(
    'same semantic vertical card remains usable at width %i',
    async (width) => {
      const ui = await render(
        <View style={{ width }}>
          <HomeNextAppointment result={success()} onOpen={jest.fn()} />
        </View>,
      );
      expect(StyleSheet.flatten(ui.toJSON()?.props.style).width).toBe(width);
      expect(ui.getByRole('heading')).toBeTruthy();
      expect(ui.getByRole('button', { name: 'Ver detalle' })).toBeTruthy();
    },
  );
});

async function mount() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity } });
  let current!: HomeNextAppointmentResult;
  let force!: () => void;
  function Probe() {
    const [, set] = useState(0);
    force = () => set((n) => n + 1);
    current = useNextAppointment();
    return null;
  }
  const ui = await render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return {
    client,
    ui,
    get result() {
      return current;
    },
    update: () => act(() => force()),
  };
}
describe('useNextAppointment', () => {
  test('reactivation refreshes DB-clock reader without polling or presenting cached prior selection', async () => {
    service.mockResolvedValueOnce({ data: null, error: null });
    const h = await mount();
    await waitFor(() => expect(h.result).toEqual({ status: 'success', data: null }));
    jest.mocked(useIsFocused).mockReturnValue(false);
    await h.update();
    expect(h.result.status).toBe('unavailable');
    let finish!: (value: Awaited<ReturnType<typeof homeService.getNextAppointment>>) => void;
    service.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    jest.mocked(useIsFocused).mockReturnValue(true);
    await h.update();
    await waitFor(() => expect(service).toHaveBeenCalledTimes(2));
    expect(h.result.status).toBe('loading');
    await act(() => finish({ data: item(), error: null }));
    await waitFor(() => expect(h.result).toEqual({ status: 'success', data: item() }));
    h.client.clear();
  });
  test('OWNER activates exactly one explicit scoped request and supports null success', async () => {
    service.mockResolvedValue({ data: null, error: null });
    const h = await mount();
    await waitFor(() => expect(h.result).toEqual({ status: 'success', data: null }));
    expect(service).toHaveBeenCalledTimes(1);
    expect(service.mock.calls[0][0]).toBe('b');
    expect(service.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    h.client.clear();
  });
  test.each([
    'unauthenticated',
    'recovering',
    'business-pending',
    'business-error',
    'invalid-timezone',
    'blurred',
    'revalidating',
  ] as const)('guard %s makes no request', async (guard) => {
    if (guard === 'unauthenticated' || guard === 'recovering')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: guard, user: null, session: null, error: null } as ReturnType<
          typeof useAuth
        >);
    else if (guard === 'blurred') jest.mocked(useIsFocused).mockReturnValue(false);
    else if (guard === 'invalid-timezone') agendaContext({ timezone: 'Invalid/Timezone' });
    else {
      const b = useBusiness();
      const next = {
        ...b,
        status:
          guard === 'business-pending'
            ? 'pending'
            : guard === 'business-error'
              ? 'error'
              : 'success',
        isFetching: guard === 'revalidating',
      };
      jest.mocked(useBusiness).mockReturnValue(next as ReturnType<typeof useBusiness>);
    }
    const h = await mount();
    expect(h.result.status).toBe('unavailable');
    expect(service).not.toHaveBeenCalled();
    h.client.clear();
  });
  test('BARBER uses own context and rejects inconsistent assigned row', async () => {
    agendaContext({ role: 'BARBER' });
    service.mockResolvedValue({ data: { ...item(), barber_member_id: 'other' }, error: null });
    const h = await mount();
    await waitFor(() => expect(h.result.status).toBe('unavailable'));
    expect(service).toHaveBeenCalledTimes(1);
    h.client.clear();
  });
  test.each([
    ['INVALID_APPOINTMENT', 'unavailable'],
    ['NETWORK_ERROR', 'error'],
  ] as const)('maps %s to %s without raw errors', async (code, status) => {
    service.mockResolvedValue({ data: null, error: { code, message: 'provider secret' } });
    const h = await mount();
    await waitFor(() => expect(h.result.status).toBe(status));
    expect(JSON.stringify(h.result)).not.toContain('secret');
    h.client.clear();
  });
  test('business transition cancels in-flight read and rejects late prior-tenant result', async () => {
    let finish!: (value: Awaited<ReturnType<typeof homeService.getNextAppointment>>) => void;
    service.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const h = await mount();
    await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
    const oldSignal = service.mock.calls[0][1]!;
    agendaContext({ businessId: 'new' });
    service.mockResolvedValue({ data: { ...item(), business_id: 'new' }, error: null });
    await h.update();
    await waitFor(() => expect(service).toHaveBeenCalledTimes(2));
    expect(oldSignal.aborted).toBe(true);
    await act(() => finish({ data: item(), error: null }));
    await waitFor(() =>
      expect(h.result).toEqual({ status: 'success', data: { ...item(), business_id: 'new' } }),
    );
    h.client.clear();
  });
  test('unmount aborts in-flight request; no polling or global cache deletion', async () => {
    service.mockImplementation(() => new Promise(() => {}));
    const h = await mount();
    await waitFor(() => expect(service).toHaveBeenCalledTimes(1));
    const signal = service.mock.calls[0][1]!;
    await h.ui.unmount();
    expect(signal.aborted).toBe(true);
    expect(h.client.getQueryCache().getAll()).toHaveLength(1);
    h.client.clear();
  });
});
