import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { CheckoutDiscountField } from '@/features/sales/components/CheckoutDiscountField';
import { CheckoutPaymentField } from '@/features/sales/components/CheckoutPaymentField';
import { CheckoutSummary } from '@/features/sales/components/CheckoutSummary';
import { useCheckoutPayment } from '@/features/sales/hooks/useCheckoutPayment';
import {
  checkoutDraftStore,
  type CheckoutCapture,
} from '@/features/sales/store/checkoutDraftStore';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { servicesService } from '@/features/services/services/servicesService';
import { renderWithProviders } from '@/test/renderWithProviders';

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
  throw new Error('No SDK, payment persistence or provider');
});
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' },
  state = () => checkoutDraftStore.getState();
const choices = [
  ['CASH', 'Efectivo'],
  ['BANK_TRANSFER', 'Transferencia bancaria'],
  ['DEBIT_CARD', 'Tarjeta de débito'],
  ['CREDIT_CARD', 'Tarjeta de crédito'],
  ['DIGITAL_WALLET', 'Billetera digital'],
] as const;
let service: ServiceRow, latest: ReturnType<typeof useCheckoutPayment>;
function Probe() {
  const model = useCheckoutPayment();
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
    <CheckoutPaymentField />
    <Probe />
  </>
);
const setup = () => renderWithProviders(tree());
const ready = () => screen.findByText('Resumen listo para revisión');
const option = (label: string) => screen.getByRole('button', { name: `Método de pago: ${label}` });
const discount = (text: string) =>
  fireEvent.changeText(screen.getByLabelText('Descuento global'), text);

test('exactly five accessible choices, none selected/default, no positive-total eligibility yet', async () => {
  await setup();
  await ready();
  expect(screen.getAllByRole('button')).toHaveLength(5);
  for (const [, label] of choices) expect(option(label)).toBeTruthy();
  expect(screen.queryAllByRole('button', { selected: true })).toHaveLength(0);
  expect(state().draft?.paymentMethod).toBeUndefined();
  expect(latest.eligible).toBe(false);
  expect(screen.getByText('Selecciona un método de pago para continuar.')).toBeTruthy();
  expect(screen.queryByText('No se registrará un cobro.')).toBeNull();
});
test.each(choices)(
  'explicit %s selection contributes eligibility without executing payment',
  async (method, label) => {
    await setup();
    await ready();
    await fireEvent.press(option(label));
    expect(state().draft?.paymentMethod).toBe(method);
    expect(latest.eligible).toBe(true);
    expect(
      screen.getByRole('button', { name: `Método de pago: ${label}`, selected: true }),
    ).toBeTruthy();
    expect(screen.getByText(`Método seleccionado: ${label}`)).toBeTruthy();
    expect(state().submission).toBeNull();
  },
);
test('switching method leaves exactly one selection and replaces the draft value', async () => {
  await setup();
  await ready();
  await fireEvent.press(option('Efectivo'));
  await fireEvent.press(option('Tarjeta de crédito'));
  expect(screen.queryAllByRole('button', { selected: true })).toHaveLength(1);
  expect(state().draft?.paymentMethod).toBe('CREDIT_CARD');
});
test('total zero still requires explicit method and shows no-charge explanation', async () => {
  await setup();
  await ready();
  await discount('100.00');
  expect(screen.getByText('No se registrará un cobro.')).toBeTruthy();
  expect(latest.zeroTotal).toBe(true);
  expect(latest.eligible).toBe(false);
  expect(state().draft?.paymentMethod).toBeUndefined();
  await fireEvent.press(option('Billetera digital'));
  expect(latest.eligible).toBe(true);
  expect(state().submission).toBeNull();
  expect(state().draft?.paymentMethod).toBe('DIGITAL_WALLET');
});
test('positive/zero transitions preserve an explicit method without resetting or defaulting', async () => {
  await setup();
  await ready();
  await fireEvent.press(option('Transferencia bancaria'));
  await discount('100.00');
  expect(latest.eligible).toBe(true);
  expect(screen.getByText('No se registrará un cobro.')).toBeTruthy();
  await discount('50.00');
  expect(screen.queryByText('No se registrará un cobro.')).toBeNull();
  expect(state().draft?.paymentMethod).toBe('BANK_TRANSFER');
  expect(latest.eligible).toBe(true);
});
test.each(['100.01', 'invalid'])(
  'invalid summary %s keeps selection but blocks combined eligibility',
  async (value) => {
    await setup();
    await ready();
    await fireEvent.press(option('Efectivo'));
    await discount(value);
    expect(latest.eligible).toBe(false);
    expect(latest.method).toBe('CASH');
    expect(screen.getByText('Método seleccionado: Efectivo')).toBeTruthy();
    expect(screen.queryByText('No se registrará un cobro.')).toBeNull();
  },
);
test('unresolved total preserves selection without asserting zero or eligibility', async () => {
  state().patchDraft(scope, 'op', { paymentMethod: 'CREDIT_CARD' });
  jest.mocked(servicesService.getById).mockImplementation(() => new Promise(() => {}));
  await setup();
  expect(latest.eligible).toBe(false);
  expect(latest.method).toBe('CREDIT_CARD');
  expect(screen.queryByText('No se registrará un cobro.')).toBeNull();
  expect(screen.getByText('Subtotal estimado: No disponible')).toBeTruthy();
});
test.each(['OTHER', 'TRANSFER', 'cash', ''])(
  'programmatic selection %s is rejected without losing current selection',
  async (method) => {
    await setup();
    await ready();
    await fireEvent.press(option('Tarjeta de débito'));
    let accepted = true;
    await act(() => {
      accepted = latest.select(method);
    });
    expect(accepted).toBe(false);
    expect(state().draft?.paymentMethod).toBe('DEBIT_CARD');
    expect(latest.eligible).toBe(true);
  },
);
test('pending and uncertain disable all choices; retry retains identical capture/method', async () => {
  await setup();
  await ready();
  await fireEvent.press(option('Transferencia bancaria'));
  let capture!: CheckoutCapture;
  await act(() => {
    capture = state().captureIntent(scope, 'op')!;
  });
  for (const [, label] of choices) expect(option(label)).toBeDisabled();
  await fireEvent.press(option('Efectivo'));
  expect(state().draft?.paymentMethod).toBe('BANK_TRANSFER');
  expect(latest.eligible).toBe(false);
  await act(() => {
    state().settleCapture(capture, 'uncertain');
  });
  for (const [, label] of choices) expect(option(label)).toBeDisabled();
  expect(latest.select('CASH')).toBe(false);
  await act(() => {
    state().retryCapture(capture);
  });
  expect(state().submission?.capture).toBe(capture);
  expect(capture.input.paymentMethod).toBe('BANK_TRANSFER');
});
test.each(['user', 'business', 'membership', 'logout'])(
  'context %s clears selection and rejects stale handler',
  async (mode) => {
    const { rerender } = await setup();
    await ready();
    await fireEvent.press(option('Efectivo'));
    const late = latest.select;
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
    expect(screen.queryByRole('button', { name: 'Método de pago: Efectivo' })).toBeNull();
    expect(late('CREDIT_CARD')).toBe(false);
    expect(state().draft).toBeNull();
  },
);
test('new same-scope draft has no method and ignores callback for previous operation', async () => {
  await setup();
  await ready();
  await fireEvent.press(option('Efectivo'));
  const late = latest.select;
  await act(() => {
    state().clearDraft(scope, 'op');
    state().startDraft(scope, 'next');
  });
  expect(state().draft?.paymentMethod).toBeUndefined();
  expect(latest.methodValid).toBe(false);
  expect(late('CREDIT_CARD')).toBe(false);
  expect(screen.queryAllByRole('button', { selected: true })).toHaveLength(0);
});
