import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import SaleDetailRoute from '@/app/(app)/sales/[id]';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { SaleDetailScreen } from '@/features/sales/screens/SaleDetailScreen';
import { useSaleDetail } from '@/features/sales/hooks/useSaleDetail';
import { salesService, saleReadError } from '@/features/sales/services/salesService';
import { salesKeys } from '@/features/sales/constants/salesKeys';
import type { SaleDetail, SaleReadResult } from '@/features/sales/types/saleDetail.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatCatalogPrice } from '@/utils/formatMoney';
import { context, scope, id, saved } from './helpers/checkoutFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useLocalSearchParams: () => ({ id: '00000000-0000-4000-8000-000000000004' }),
}));
jest.mock('@/features/sales/services/salesService', () => ({
  ...jest.requireActual('@/features/sales/services/salesService'),
  salesService: { getById: jest.fn(), getCorrectionDetail: jest.fn(), voidSale: jest.fn() },
}));
jest.mock('@/features/sales/repositories/salesRepository', () => ({
  salesRepository: { getById: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No SDK or current catalog');
});
let current: SaleDetail, latest: ReturnType<typeof useSaleDetail>;
function Probe({ saleId = id(4) }: { saleId?: string | null }) {
  const value = useSaleDetail(saleId);
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
function detail(): SaleDetail {
  const value = saved();
  return { ...value.sale, sale_items: value.items, payments: value.payments };
}
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  context();
  current = detail();
  jest.mocked(salesService.getCorrectionDetail).mockResolvedValue({
    data: null,
    error: { code: 'INCOMPLETE_HISTORY', message: 'El historial de la venta está incompleto.' },
  });
  jest
    .mocked(salesService.getById)
    .mockImplementation(async () => ({ data: current, error: null }));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const setup = () => renderWithProviders(<SaleDetailRoute />);
const money = (value: number) => formatCatalogPrice(value, 'ARS');
function deferred() {
  let resolve!: (value: SaleReadResult) => void;
  const promise = new Promise<SaleReadResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('route displays persisted sale identity, status, snapshots, quantities, prices and totals', async () => {
  current.sale_items[0].quantity = 2;
  current.sale_items[0].unit_price_snapshot = 50;
  await setup();
  await screen.findByText(`Venta: ${id(4)}`);
  expect(screen.getByText('Completada')).toBeTruthy();
  expect(screen.getByText('Corte histórico')).toBeTruthy();
  expect(screen.getByText('Shampoo histórico')).toBeTruthy();
  expect(screen.getByText('Cantidad: 2')).toBeTruthy();
  expect(screen.getByText(`Precio unitario histórico: ${money(50)}`)).toBeTruthy();
  expect(screen.getByText(`Subtotal: ${money(110)}`)).toBeTruthy();
  expect(screen.getByText(`Descuento: ${money(0)}`)).toBeTruthy();
  expect(screen.getByText(`Total: ${money(110)}`)).toBeTruthy();
  expect(screen.getByText('Venta directa')).toBeTruthy();
  expect(screen.getByText('Método: Transferencia bancaria')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Anular venta' })).toBeTruthy();
  expect(salesService.getById).toHaveBeenCalledWith(scope.businessId, id(4));
});
test('snapshot presentation never requests catalog or overwrites historical prices', async () => {
  await setup();
  await screen.findByText('Corte histórico');
  expect(screen.queryByText('Corte')).toBeNull();
  expect(screen.queryByText('Shampoo')).toBeNull();
  expect(screen.getByText(`Costo unitario histórico: ${money(4)}`)).toBeTruthy();
  expect(salesService.getById).toHaveBeenCalledTimes(1);
});
test('unsupported timezone never crashes or invents another timezone for historical dates', async () => {
  const getBusiness = jest.mocked(useBusiness).getMockImplementation();
  if (!getBusiness) throw new Error('fixture');
  const business = getBusiness();
  if (business.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({
    ...business,
    data: {
      ...business.data,
      business: { ...business.data.business, timezone: 'Unsupported/Zone' },
    },
  });
  await setup();
  await screen.findByText(`Venta: ${id(4)}`);
  expect(screen.getByText('Fecha de venta: Fecha no disponible')).toBeTruthy();
  expect(screen.getByText('Corte histórico')).toBeTruthy();
});
test('role downgrade with the same membership hides previously cached OWNER-only data', async () => {
  const { rerender } = await setup();
  await screen.findByText('Corte histórico');
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  jest
    .mocked(salesService.getById)
    .mockResolvedValue({ data: null, error: saleReadError('NOT_FOUND') });
  await rerender(<SaleDetailRoute />);
  expect(screen.queryByText('Corte histórico')).toBeNull();
  await screen.findByText('Venta no disponible.');
});
test('visible multiple payments render individually without recomputing persisted total', async () => {
  current.payments.push({ ...current.payments[0], id: id(81), payment_method: 'CASH', amount: 5 });
  await setup();
  await screen.findByText('Método: Efectivo');
  expect(screen.getAllByText(/Importe del pago:/)).toHaveLength(2);
  expect(screen.getByText(`Total: ${money(110)}`)).toBeTruthy();
});
test.each([0, 110])(
  'empty visible payments with total%s use exact neutral copy, no debt inference',
  async (total) => {
    current.total = total;
    current.payments = [];
    await setup();
    await screen.findByText('No hay pagos visibles');
    expect(screen.queryByText(/Impago|Deuda|Sin cobros|Pago faltante/i)).toBeNull();
    expect(screen.getByText(`Total: ${money(total)}`)).toBeTruthy();
  },
);
test('appointment and client references use persisted IDs without extra joins', async () => {
  current.appointment_id = id(9);
  current.client_id = id(11);
  await setup();
  await screen.findByText(`Cita: ${id(9)}`);
  expect(screen.getByText(`Cliente: ${id(11)}`)).toBeTruthy();
  expect(screen.queryByText('Venta directa')).toBeNull();
});
test.each(['DRAFT', 'VOIDED'] as const)(
  '%s detail is visible and has no correction/void action or audit reader',
  async (status) => {
    current.status = status;
    current.sold_at = status === 'DRAFT' ? null : current.sold_at;
    await setup();
    await screen.findByText(status === 'DRAFT' ? 'Borrador' : 'Anulada');
    expect(screen.queryByRole('button', { name: /Anular|Corregir|Historial/ })).toBeNull();
    if (status === 'DRAFT') expect(screen.getByText('Fecha de venta: No registrada')).toBeTruthy();
  },
);
test('loading is not an empty sale; resolved result then renders actual fields', async () => {
  const pending = deferred();
  jest.mocked(salesService.getById).mockReturnValue(pending.promise);
  await setup();
  expect(screen.getByText('Cargando venta…')).toBeTruthy();
  expect(screen.queryByText(/Venta:/)).toBeNull();
  await act(() => {
    pending.resolve({ data: current, error: null });
  });
  await screen.findByText('Corte histórico');
});
test.each(['NOT_FOUND', 'ACCESS_DENIED', 'NETWORK_ERROR', 'UNKNOWN_ERROR'] as const)(
  'safe %s state exposes no data and supports read retry',
  async (code) => {
    jest
      .mocked(salesService.getById)
      .mockResolvedValueOnce({ data: null, error: saleReadError(code) });
    await setup();
    await screen.findByText(saleReadError(code).message);
    expect(screen.queryByText('Corte histórico')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText('Corte histórico');
  },
);
test.each(['user', 'business', 'membership', 'role', 'logout'])(
  'scope %s never displays late data from prior request',
  async (mode) => {
    const pending = deferred();
    jest.mocked(salesService.getById).mockReturnValueOnce(pending.promise);
    const { rerender } = await setup();
    if (mode === 'user') context(id(50));
    if (mode === 'business') context(scope.userId, id(50));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(50));
    if (mode === 'role') context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    jest
      .mocked(salesService.getById)
      .mockResolvedValue({ data: null, error: saleReadError('NOT_FOUND') });
    await rerender(<SaleDetailRoute />);
    await act(() => {
      pending.resolve({ data: current, error: null });
    });
    expect(screen.queryByText('Corte histórico')).toBeNull();
    if (mode === 'logout') expect(screen.getByText('No tienes acceso a esta venta.')).toBeTruthy();
    else await screen.findByText('Venta no disponible.');
  },
);
test('sale-id change and late old response cannot replace current sale; keys are precise', async () => {
  const pending = deferred();
  jest.mocked(salesService.getById).mockReturnValueOnce(pending.promise);
  const { rerender, queryClient } = await renderWithProviders(<Probe />);
  const next = { ...current, id: id(90), sale_items: [], payments: [] };
  jest.mocked(salesService.getById).mockResolvedValue({ data: next, error: null });
  await rerender(<Probe saleId={id(90)} />);
  await waitFor(() => expect(latest.status).toBe('success'));
  await act(() => {
    pending.resolve({ data: current, error: null });
  });
  expect(latest.data?.id).toBe(id(90));
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .every((q) => q.queryKey[0] === 'sales'),
  ).toBe(true);
  expect(queryClient.getQueryData(salesKeys.detail({ ...scope, role: 'OWNER' }, id(90)))).toEqual(
    next,
  );
});
test('invalid sale id and lost business context do not issue a query', async () => {
  const { rerender } = await renderWithProviders(<SaleDetailScreen saleId={null} />);
  expect(screen.getByText('Los datos de la consulta no son válidos.')).toBeTruthy();
  expect(salesService.getById).not.toHaveBeenCalled();
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await rerender(<SaleDetailScreen saleId={id(4)} />);
  expect(screen.getByText('No tienes acceso a esta venta.')).toBeTruthy();
  expect(salesService.getById).not.toHaveBeenCalled();
});
