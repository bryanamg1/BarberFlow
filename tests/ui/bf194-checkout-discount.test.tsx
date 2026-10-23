import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { CheckoutDiscountField } from '@/features/sales/components/CheckoutDiscountField';
import { CheckoutSummary } from '@/features/sales/components/CheckoutSummary';
import { useCheckoutDiscount } from '@/features/sales/hooks/useCheckoutDiscount';
import { checkoutDraftStore } from '@/features/sales/store/checkoutDraftStore';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { servicesService } from '@/features/services/services/servicesService';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatMoney } from '@/utils/formatMoney';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: { getById: jest.fn() },
}));
jest.mock('@/features/products/services/productsService', () => ({
  productsService: { getById: jest.fn() },
}));
jest.mock('@/features/inventory/services/inventoryService', () => ({
  inventoryService: { getProductStock: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK or financial writes');
});
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const state = () => checkoutDraftStore.getState();
let service: ServiceRow, latest: ReturnType<typeof useCheckoutDiscount>;
function Probe() {
  const model = useCheckoutDiscount();
  useEffect(() => {
    latest = model;
  }, [model]);
  return null;
}
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
  service = {
    id: 's',
    business_id: 'b',
    name: 'Corte',
    price: 100,
    duration_minutes: 30,
    description: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
  state().addLine(scope, 'op', { lineId: 'a', itemType: 'SERVICE', itemId: 's', quantity: 1 }, 'b');
  jest
    .mocked(servicesService.getById)
    .mockImplementation(async () => ({ data: service, error: null }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const tree = () => (
  <>
    <CheckoutDiscountField />
    <CheckoutSummary />
    <Probe />
  </>
);
const setup = () => renderWithProviders(tree());
const ready = () => screen.findByText('Resumen listo para revisión');
const input = () => screen.getByLabelText('Descuento global');
const change = (text: string) => fireEvent.changeText(input(), text);

test('initial discount and existing value render; accessible input replaces not accumulates', async () => {
  await setup();
  await ready();
  expect(input()).toHaveDisplayValue('0.00');
  await change('5.00');
  await change('3.00');
  expect(input()).toHaveDisplayValue('3.00');
  expect(state().draft?.discountAmount).toBe('3.00');
  expect(latest.canonicalAmount).toBe('3.00');
  expect(screen.getByText(`Total estimado: ${formatMoney('97.00', 'ARS')}`)).toBeTruthy();
});
test('preexisting discount is adopted, not reset on mount', async () => {
  state().patchDraft(scope, 'op', { discountAmount: '12.34' });
  await setup();
  await ready();
  expect(input()).toHaveDisplayValue('12.34');
});
test.each(['0.00', '50.00', '100.00'])(
  'discount %s is valid, full discount produces genuine zero',
  async (text) => {
    await setup();
    await ready();
    await change(text);
    expect(latest.error).toBeUndefined();
    expect(latest.eligible).toBe(true);
    if (text === '100.00') expect(latest.total).toBe('0.00');
  },
);
test('excessive discount stays visible invalid until corrected explicitly', async () => {
  await setup();
  await ready();
  await change('100.01');
  expect(input()).toHaveDisplayValue('100.01');
  expect(latest.eligible).toBe(false);
  expect(latest.total).toBeNull();
  expect(screen.getAllByText(/El descuento supera el subtotal/).length).toBeGreaterThan(0);
  await change('99.99');
  expect(latest.total).toBe('0.01');
  expect(latest.eligible).toBe(true);
});
test('removing lines lowers subtotal without clamping or clearing discount', async () => {
  state().addLine(scope, 'op', { lineId: 'b', itemType: 'SERVICE', itemId: 's', quantity: 1 }, 'b');
  await setup();
  await ready();
  await change('150.00');
  expect(latest.eligible).toBe(true);
  await act(() => {
    state().removeLine(scope, 'op', 'b');
  });
  expect(input()).toHaveDisplayValue('150.00');
  expect(latest.subtotal).toBe('100.00');
  expect(latest.total).toBeNull();
  expect(latest.eligible).toBe(false);
});
test.each(['', '-1.00', 'NaN', 'Infinity', 'abc', '1.001', '1,00'])(
  'invalid text %s never leaves a stale-valid summary/capture',
  async (text) => {
    await setup();
    await ready();
    await change('5.00');
    await change(text);
    expect(input()).toHaveDisplayValue(text);
    expect(latest.canonicalAmount).toBeNull();
    expect(latest.total).toBeNull();
    expect(latest.eligible).toBe(false);
    expect(latest.error).toBeTruthy();
    expect(input().props.accessibilityHint).toContain('Error:');
    expect(screen.getByText('Total estimado: No disponible')).toBeTruthy();
  },
);
test.each(['loading', 'error', 'unavailable'])(
  'subtotal %s is not zero and preserves discount',
  async (mode) => {
    state().patchDraft(scope, 'op', { discountAmount: '50.00' });
    if (mode === 'loading')
      jest.mocked(servicesService.getById).mockImplementation(() => new Promise(() => {}));
    if (mode === 'error')
      jest.mocked(servicesService.getById).mockResolvedValue({
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
      });
    if (mode === 'unavailable') service = { ...service, is_active: false };
    await setup();
    await screen.findByText(/Subtotal no disponible\. El descuento ingresado se conserva/);
    if (mode === 'error')
      await screen.findByText('No se pudo resolver el catálogo o stock del resumen.');
    if (mode === 'unavailable')
      await screen.findByText('Referencia no disponible; la línea se conserva.');
    expect(input()).toHaveDisplayValue('50.00');
    expect(latest.subtotal).toBeNull();
    expect(latest.eligible).toBe(false);
    expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
  },
);
test('pending and uncertain lock input; explicit retry retains identical capture/discount', async () => {
  await setup();
  await ready();
  await change('5.00');
  let capture!: NonNullable<ReturnType<ReturnType<typeof state>['captureIntent']>>;
  await act(() => {
    state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
    capture = state().captureIntent(scope, 'op')!;
  });
  expect(input()).toBeDisabled();
  await change('7.00');
  expect(state().draft?.discountAmount).toBe('5.00');
  await act(() => {
    state().settleCapture(capture, 'uncertain');
  });
  expect(input()).toBeDisabled();
  expect(latest.change('9.00')).toBe(false);
  await act(() => {
    state().retryCapture(capture);
  });
  expect(state().submission?.capture).toBe(capture);
  expect(capture.input.discountAmount).toBe('5.00');
});
test.each(['user', 'business', 'membership', 'logout'])(
  'context %s hides old input and rejects captured edit handler',
  async (mode) => {
    const { rerender } = await setup();
    await ready();
    await change('5.00');
    const late = latest.change;
    if (mode === 'user') context('next');
    if (mode === 'business') context('u', 'next');
    if (mode === 'membership') context('u', 'b', 'next');
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    await act(() => {
      state().setScope(null);
    });
    await rerender(tree());
    expect(screen.queryByLabelText('Descuento global')).toBeNull();
    expect(late('8.00')).toBe(false);
    expect(state().draft).toBeNull();
  },
);
test('new draft resets discount and rejects stale same-scope operation callback', async () => {
  await setup();
  await ready();
  await change('5.00');
  const late = latest.change;
  await act(() => {
    state().clearDraft(scope, 'op');
    state().startDraft(scope, 'next');
  });
  expect(input()).toHaveDisplayValue('0.00');
  expect(late('8.00')).toBe(false);
  expect(state().draft?.operationId).toBe('next');
});
