import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { CheckoutServiceItems } from '@/features/sales/components/CheckoutServiceItems';
import { checkoutDraftStore } from '@/features/sales/store/checkoutDraftStore';
import { useCheckoutServiceItems } from '@/features/sales/hooks/useCheckoutServiceItems';
import { addCheckoutService } from '@/features/sales/utils/checkoutServiceItems';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { servicesService } from '@/features/services/services/servicesService';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { list: jest.fn(), getById: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No Supabase in BF191');
});
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  return { ...actual, uuid: { v4: jest.fn() } };
});
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const catalog = jest.mocked(servicesService);
const row = (patch: Partial<ServiceRow> = {}): ServiceRow => ({
  id: 's',
  business_id: 'b',
  name: 'Corte',
  price: 10,
  duration_minutes: 30,
  description: null,
  is_active: true,
  created_at: '',
  updated_at: '',
  ...patch,
});
let current: ServiceRow;
function context(userId = 'u', businessId = 'b', membershipId = 'm') {
  jest.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { id: userId },
    session: {},
    error: null,
  } as ReturnType<typeof useAuth>);
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role: 'OWNER',
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
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  current = row();
  let sequence = 0;
  jest.mocked(uuid.v4).mockImplementation(() => `local-${++sequence}`);
  checkoutDraftStore.getState().setScope(null);
  checkoutDraftStore.getState().setScope(scope);
  checkoutDraftStore.getState().startDraft(scope, 'op');
  catalog.list.mockImplementation(async () => ({
    data: { items: [current], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  }));
  catalog.getById.mockImplementation(async () => ({ data: current, error: null }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const state = () => checkoutDraftStore.getState();
async function setup() {
  const eligibility = jest.fn();
  const view = await renderWithProviders(
    <CheckoutServiceItems onEligibilityChange={eligibility} />,
  );
  await screen.findByRole('button', { name: 'Agregar servicio: Corte' });
  return { ...view, eligibility };
}
async function add() {
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar servicio: Corte' }));
  await screen.findByLabelText('Cantidad de línea 1');
  await screen.findByText('Servicios listos para revisión');
}
test('each Add creates a fresh line, sibling edits/overrides/remove remain independent', async () => {
  await setup();
  await add();
  await add();
  expect(catalog.getById).toHaveBeenCalledTimes(1);
  expect(state().draft?.items.map((x) => x.lineId)).toEqual(['local-1', 'local-2']);
  await fireEvent.changeText(screen.getByLabelText('Cantidad de línea 1'), '2');
  await fireEvent.changeText(screen.getByLabelText('Precio unitario opcional de línea 1'), '8.25');
  await fireEvent.changeText(screen.getByLabelText('Precio unitario opcional de línea 2'), '9.00');
  expect(state().draft?.items.map((x) => [x.quantity, x.unitPriceOverride])).toEqual([
    [2, '8.25'],
    [1, '9.00'],
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Quitar servicio de línea 1' }));
  expect(state().draft?.items.map((x) => x.lineId)).toEqual(['local-2']);
});
test.each(['0', '-1', '1.5', '2147483648', '', 'abc'])(
  'invalid quantity %s stays visible and blocks service eligibility',
  async (text) => {
    const { eligibility } = await setup();
    await add();
    await fireEvent.changeText(screen.getByLabelText('Cantidad de línea 1'), text);
    expect(screen.getByLabelText('Cantidad de línea 1')).toHaveDisplayValue(text);
    expect(state().draft?.items[0].quantity).toBe(1);
    await waitFor(() =>
      expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false }),
    );
  },
);
test.each(['-1.00', '0.001', '10000000000.00', ''])(
  'invalid override %s blocks without coercion',
  async (text) => {
    const { eligibility } = await setup();
    await add();
    await fireEvent.changeText(screen.getByLabelText('Precio unitario opcional de línea 1'), text);
    expect(state().draft?.items[0].unitPriceOverride).toBeUndefined();
    expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  },
);
test('catalog changes update only the estimate, and explicit override survives refresh', async () => {
  const { queryClient } = await setup();
  await add();
  current = row({ price: 12 });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: servicesKeys.byBusiness('b') });
  });
  await screen.findByText(/Precio de catálogo actualizado/);
  expect(screen.getByText(/Estimación de línea 1: ARS.*12,00/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Precio unitario opcional de línea 1'), '8.25');
  current = row({ price: 15 });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: servicesKeys.byBusiness('b') });
  });
  expect(state().draft?.items[0].unitPriceOverride).toBe('8.25');
  expect(screen.getByText(/Estimación de línea 1: ARS.*8,25/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Usar precio de catálogo de línea 1' }));
  expect(state().draft?.items[0].unitPriceOverride).toBeUndefined();
  expect(screen.getByText(/Estimación de línea 1: ARS.*15,00/)).toBeTruthy();
});
test.each(['archived', 'foreign', 'missing'])(
  '%s selected Service stays visible/removable and blocks eligibility',
  async (mode) => {
    const { queryClient, eligibility } = await setup();
    await add();
    if (mode === 'archived') current = row({ is_active: false });
    if (mode === 'foreign') current = row({ business_id: 'other' });
    if (mode === 'missing')
      catalog.getById.mockResolvedValue({
        data: null,
        error: { code: 'SERVICE_NOT_FOUND', message: 'No disponible' },
      });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: servicesKeys.byBusiness('b') });
    });
    expect(state().draft?.items).toHaveLength(1);
    expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
    expect(screen.queryByText(/Estimación de línea/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar servicio de línea 1' }));
    expect(state().draft?.items).toHaveLength(0);
  },
);
test('detail loading and error never produce a zero estimate', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof servicesService.getById>>) => void;
  catalog.getById.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { eligibility } = await setup();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar servicio: Corte' }));
  await screen.findByText('Consultando servicio seleccionado…');
  expect(screen.queryByText(/Estimación de línea/)).toBeNull();
  expect(eligibility).toHaveBeenLastCalledWith({ scope, operationId: 'op', eligible: false });
  await act(async () => {
    resolve({ data: null, error: { code: 'NETWORK_ERROR', message: 'Error seguro' } });
  });
  await screen.findByText(/No se pudo consultar el servicio/);
  expect(screen.queryByText(/Estimación de línea/)).toBeNull();
  expect(state().draft?.items).toHaveLength(1);
  catalog.getById.mockResolvedValue({ data: current, error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar servicio de línea 1' }));
  await screen.findByText('Servicios listos para revisión');
});
test('new foreign/archived selections are not offered', async () => {
  catalog.list.mockResolvedValue({
    data: {
      items: [row({ business_id: 'foreign' }), row({ id: 'old', is_active: false })],
      page: 1,
      pageSize: 25,
      hasNextPage: false,
    },
    error: null,
  });
  await renderWithProviders(<CheckoutServiceItems />);
  await screen.findByText('No hay servicios activos para seleccionar');
  expect(screen.queryByRole('button', { name: /Agregar servicio/ })).toBeNull();
});
test('pending capture disables service edits and Add without submitting', async () => {
  await setup();
  await add();
  await act(() => {
    state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
    state().captureIntent(scope, 'op');
  });
  expect(screen.getByRole('button', { name: 'Agregar servicio: Corte' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Quitar servicio de línea 1' })).toBeDisabled();
  expect(screen.getByLabelText('Cantidad de línea 1')).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar servicio: Corte' }));
  expect(state().draft?.items).toHaveLength(1);
});
test.each(['user', 'business', 'membership', 'logout'])(
  'context %s hides previous lines and ignores stale handlers',
  async (change) => {
    const { rerender } = await setup();
    await add();
    const oldPress = () => addCheckoutService(scope, 'op', 'late-line', current);
    const next = {
      ...scope,
      [change === 'user' ? 'userId' : change === 'business' ? 'businessId' : 'membershipId']:
        'next',
    };
    context(next.userId, next.businessId, next.membershipId);
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    await act(() => {
      state().setScope(change === 'logout' ? null : next);
      if (change !== 'logout') state().startDraft(next, 'new-op');
    });
    await rerender(<CheckoutServiceItems />);
    await act(() => {
      expect(oldPress()).toBe(false);
    });
    expect(state().draft?.items ?? []).toHaveLength(0);
    expect(screen.queryByLabelText('Cantidad de línea 1')).toBeNull();
  },
);
test('reset clears Service lines without any persistence request', async () => {
  await setup();
  await add();
  await act(() => {
    state().clearDraft(scope, 'op');
  });
  await screen.findByText('No hay una intención de checkout activa');
  expect(Object.keys(catalog).sort()).toEqual(['getById', 'list']);
});

test('a pre-capture edit callback cannot change local inputs once submission becomes pending', async () => {
  state().addLine(scope, 'op', { lineId: 'a', itemType: 'SERVICE', itemId: 's', quantity: 1 }, 'b');
  let model!: ReturnType<typeof useCheckoutServiceItems>;
  function Probe() {
    model = useCheckoutServiceItems();
    return null;
  }
  await renderWithProviders(<Probe />);
  await waitFor(() => expect(model.rows[0].eligible).toBe(true));
  const oldEdit = model.editLine;
  await act(() => {
    state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
    state().captureIntent(scope, 'op');
  });
  await act(() => {
    oldEdit('a', 'quantity', 'invalid');
  });
  expect(model.rows[0].quantityText).toBe('1');
  expect(state().draft?.items[0].quantity).toBe(1);
});
