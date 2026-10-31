import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import { useEffect } from 'react';
import SaleHistoryRoute from '@/app/(app)/sales';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { salesKeys } from '@/features/sales/constants/salesKeys';
import { SaleDetailScreen } from '@/features/sales/screens/SaleDetailScreen';
import { SaleHistoryScreen } from '@/features/sales/screens/SaleHistoryScreen';
import { useSaleHistory } from '@/features/sales/hooks/useSaleHistory';
import { useSaleCorrectionDetail } from '@/features/sales/hooks/useSaleCorrectionDetail';
import { useVoidSale } from '@/features/sales/hooks/useVoidSale';
import { salesService, saleReadError } from '@/features/sales/services/salesService';
import { saleCorrectionError } from '@/features/sales/services/saleCorrection';
import type { SaleDetail } from '@/features/sales/types/saleDetail.types';
import type {
  CorrectionResult,
  SaleCorrectionData,
  SaleHistoryParams,
  SaleHistoryResult,
  VoidSaleData,
} from '@/features/sales/types/saleCorrection.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { routerMock } from '@/test/routerTestUtils';
import { formatCatalogPrice } from '@/utils/formatMoney';
import { context, scope, id, saved, at } from './helpers/checkoutFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/sales/services/salesService', () => ({
  ...jest.requireActual('@/features/sales/services/salesService'),
  salesService: {
    listHistory: jest.fn(),
    getById: jest.fn(),
    getCorrectionDetail: jest.fn(),
    voidSale: jest.fn(),
  },
}));
jest.mock('@/features/sales/repositories/salesRepository', () => ({ salesRepository: {} }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core'),
  uuid: { v4: jest.fn() },
}));
let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
  Stack: { Screen: () => null },
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
}));
const service = jest.mocked(salesService);
function detail(): SaleDetail {
  const d = saved();
  return { ...d.sale, sale_items: d.items, payments: d.payments };
}
function corrected(): VoidSaleData {
  const d = saved();
  return {
    ...d,
    sale: { ...d.sale, status: 'VOIDED' },
    correction: {
      id: id(70),
      business_id: scope.businessId,
      sale_id: id(4),
      operation_id: id(71),
      reason: '  Motivo original  ',
      created_by: scope.userId,
      created_at: at,
    },
    stockMovements: [
      {
        id: id(72),
        business_id: scope.businessId,
        product_id: id(3),
        type: 'RETURN',
        quantity_delta: 1,
        unit_cost: 4,
        reference_type: 'SALE_VOID',
        reference_id: id(70),
        notes: null,
        occurred_at: at,
        created_by: scope.userId,
        created_at: at,
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let current: SaleDetail;
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  mockFocused = true;
  context();
  current = detail();
  service.getById.mockImplementation(async () => ({ data: current, error: null }));
  service.listHistory.mockResolvedValue({
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  service.getCorrectionDetail.mockImplementation(async () => ({
    data: { correction: corrected().correction, stockMovements: corrected().stockMovements },
    error: null,
  }));
  service.voidSale.mockImplementation(async (_b, input) => ({
    data: {
      ...corrected(),
      correction: {
        ...corrected().correction,
        reason: input.reason,
        operation_id: input.operationId,
      },
    },
    error: null,
  }));
  let sequence = 70;
  jest.mocked(uuid.v4).mockImplementation(() => id(++sequence));
});
afterEach(() => notifyManager.setScheduler(defaultScheduler));
const press = async (label: string) =>
  fireEvent.press(screen.getAllByRole('button', { name: label }).at(-1)!);
const mount = () => renderWithProviders(<SaleDetailScreen saleId={id(4)} />);
async function open() {
  await screen.findByText('Corte histórico');
  await press('Anular venta');
}
async function confirm(reason = '  Motivo original  ') {
  await fireEvent.changeText(screen.getByLabelText('Motivo'), reason);
  await press('Anular venta');
}

test.each(['OWNER', 'BARBER'] as const)(
  'history route %s default page and safe empty state',
  async (role) => {
    context(scope.userId, scope.businessId, scope.membershipId, role);
    await renderWithProviders(<SaleHistoryRoute />);
    await screen.findByText('No hay ventas');
    expect(screen.getByText('No hay ventas registradas.')).toBeTruthy();
    expect(service.listHistory).toHaveBeenCalledWith({
      businessId: scope.businessId,
      page: 1,
      pageSize: 25,
      status: undefined,
    });
  },
);
test.each(['DRAFT', 'COMPLETED', 'VOIDED'] as const)(
  'history renders %s and navigates exact persisted sale without destructive actions',
  async (status) => {
    service.listHistory.mockResolvedValue({
      data: {
        items: [{ ...current, status, sold_at: null }],
        page: 1,
        pageSize: 25,
        hasNextPage: false,
      },
      error: null,
    });
    await renderWithProviders(<SaleHistoryScreen />);
    const row = await screen.findByRole('button', { name: /Ver venta:/ });
    expect(screen.getByText(formatCatalogPrice(current.total, 'ARS'))).toBeTruthy();
    expect(
      screen.getAllByText(
        status === 'DRAFT' ? 'Borrador' : status === 'VOIDED' ? 'Anulada' : 'Completada',
      ).length,
    ).toBeGreaterThan(0);
    expect(row.props.accessibilityLabel).not.toContain('No registrada');
    expect(screen.queryByText('Corte histórico')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular venta' })).toBeNull();
    await fireEvent.press(row);
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/sales/[id]',
      params: { id: id(4) },
    });
  },
);
test('history filter resets pagination and shows approved filtered empty copy', async () => {
  service.listHistory.mockImplementation(async (input) => ({
    data: { items: [], page: input.page ?? 1, pageSize: 25, hasNextPage: input.page === 1 },
    error: null,
  }));
  await renderWithProviders(<SaleHistoryScreen />);
  await screen.findByText('No hay ventas');
  await press('Siguiente');
  await screen.findByText('Página 2');
  await press('Anulada');
  await screen.findByText('No hay ventas para mostrar en este período o filtro.');
  expect(service.listHistory).toHaveBeenLastCalledWith({
    businessId: scope.businessId,
    page: 1,
    pageSize: 25,
    status: 'VOIDED',
  });
});
test('history loading/error/retry distinguish empty results and preserve safe read contract', async () => {
  const d = deferred<SaleHistoryResult>();
  service.listHistory.mockReturnValueOnce(d.promise);
  await renderWithProviders(<SaleHistoryScreen />);
  expect(screen.getByText('Cargando ventas…')).toBeTruthy();
  expect(screen.queryByText('No hay ventas')).toBeNull();
  await act(() => d.resolve({ data: null, error: saleReadError('NETWORK_ERROR') }));
  await screen.findByText(saleReadError('NETWORK_ERROR').message);
  await press('Reintentar');
  await screen.findByText('No hay ventas');
});
let latestHistory!: ReturnType<typeof useSaleHistory>;
function HistoryProbe({ params = {} }: { params?: SaleHistoryParams }) {
  const result = useSaleHistory(params);
  useEffect(() => {
    latestHistory = result;
  }, [result]);
  return null;
}
test.each([{ page: 0 }, { pageSize: 101 }, { pageSize: 0 }])(
  'history invalid params %j no request',
  async (params) => {
    await renderWithProviders(<HistoryProbe params={params} />);
    expect(latestHistory.error?.code).toBe('INVALID_INPUT');
    expect(service.listHistory).not.toHaveBeenCalled();
  },
);
test('history invalid context and blur skip requests/refetch', async () => {
  mockFocused = false;
  await renderWithProviders(<HistoryProbe />);
  await act(() => latestHistory.refetch());
  expect(latestHistory.status).toBe('idle');
  expect(service.listHistory).not.toHaveBeenCalled();
});
test('history stale filter response never replaces current filter', async () => {
  const d = deferred<SaleHistoryResult>();
  service.listHistory.mockReturnValueOnce(d.promise);
  const view = await renderWithProviders(<HistoryProbe />);
  await view.rerender(<HistoryProbe params={{ status: 'VOIDED' }} />);
  await waitFor(() => expect(latestHistory.status).toBe('success'));
  await act(() =>
    d.resolve({
      data: { items: [current], page: 1, pageSize: 25, hasNextPage: false },
      error: null,
    }),
  );
  expect(latestHistory.data?.items).toEqual([]);
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s COMPLETED correction reader stays disabled',
  async (role) => {
    context(scope.userId, scope.businessId, scope.membershipId, role);
    await mount();
    await screen.findByText('Corte histórico');
    expect(service.getCorrectionDetail).not.toHaveBeenCalled();
    expect(screen.queryByText('Stock restituido')).toBeNull();
  },
);
test('OWNER VOIDED reads approved correction, historical names and safe actor without internal IDs', async () => {
  current.status = 'VOIDED';
  await mount();
  await screen.findByText('Motivo:   Motivo original  ');
  expect(service.getCorrectionDetail).toHaveBeenCalledWith(scope.businessId, id(4));
  expect(screen.getByText('Anulada por: Tú')).toBeTruthy();
  expect(screen.getByText('Stock restituido')).toBeTruthy();
  expect(screen.getByText('Cantidad restituida: 1')).toBeTruthy();
  expect(screen.getAllByText('Shampoo histórico')).toHaveLength(2);
  for (const secret of [id(70), id(71), id(72), scope.businessId, scope.userId])
    expect(screen.queryByText(new RegExp(secret))).toBeNull();
});
test('other OWNER actor is a safe label without profile lookup', async () => {
  current.status = 'VOIDED';
  service.getCorrectionDetail.mockResolvedValue({
    data: {
      correction: { ...corrected().correction, created_by: id(88) },
      stockMovements: corrected().stockMovements,
    },
    error: null,
  });
  await mount();
  await screen.findByText('Anulada por: Otro OWNER');
  expect(screen.queryByText(id(88))).toBeNull();
});
test('BARBER VOIDED retains visible sale/payment while never requesting correction', async () => {
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  current.status = 'VOIDED';
  await mount();
  await screen.findByText('Anulada');
  expect(screen.getByText('Método: Transferencia bancaria')).toBeTruthy();
  expect(service.getCorrectionDetail).not.toHaveBeenCalled();
  expect(screen.queryByText('Stock restituido')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Anular venta' })).toBeNull();
});
test('VOIDED correction null is INCOMPLETE_HISTORY, not a fabricated absence', async () => {
  current.status = 'VOIDED';
  service.getCorrectionDetail.mockResolvedValue({
    data: { correction: null, stockMovements: [] },
    error: null,
  });
  await mount();
  await screen.findByText(saleCorrectionError('INCOMPLETE_HISTORY').message);
  expect(screen.queryByText('Stock restituido')).toBeNull();
});
test('SERVICE-only correction has audit and no restitution heading', async () => {
  current.status = 'VOIDED';
  current.sale_items = current.sale_items.filter((i) => i.item_type === 'SERVICE');
  service.getCorrectionDetail.mockResolvedValue({
    data: { correction: corrected().correction, stockMovements: [] },
    error: null,
  });
  await mount();
  await screen.findByText('Anulada por: Tú');
  expect(screen.queryByText('Stock restituido')).toBeNull();
});
test('duplicate product lines preserve both restitutions', async () => {
  current.status = 'VOIDED';
  current.sale_items.push({ ...current.sale_items[1], id: id(87) });
  service.getCorrectionDetail.mockResolvedValue({
    data: {
      correction: corrected().correction,
      stockMovements: [
        ...corrected().stockMovements,
        { ...corrected().stockMovements[0], id: id(88) },
      ],
    },
    error: null,
  });
  await mount();
  await screen.findByText('Stock restituido');
  expect(screen.getAllByText('Cantidad restituida: 1')).toHaveLength(2);
});
test('inconsistent restitution correlation produces safe error without extra catalog requests', async () => {
  current.status = 'VOIDED';
  service.getCorrectionDetail.mockResolvedValue({
    data: {
      correction: corrected().correction,
      stockMovements: [{ ...corrected().stockMovements[0], product_id: id(99) }],
    },
    error: null,
  });
  await mount();
  await screen.findByText(saleCorrectionError('INCOMPLETE_HISTORY').message);
  expect(screen.queryByText('Stock restituido')).toBeNull();
});
test.each(['DRAFT', 'VOIDED'] as const)('%s never offers void', async (status) => {
  current.status = status;
  await mount();
  await screen.findByText(status === 'DRAFT' ? 'Borrador' : 'Anulada');
  expect(screen.queryByRole('button', { name: 'Anular venta' })).toBeNull();
  expect(service.voidSale).not.toHaveBeenCalled();
});
test('business revalidation hides destructive action', async () => {
  const view = await mount();
  await screen.findByText('Corte histórico');
  const business = jest.mocked(useBusiness)();
  if (business.status !== 'success') throw new Error('fixture');
  jest.mocked(useBusiness).mockReturnValue({ ...business, isFetching: true });
  await view.rerender(<SaleDetailScreen saleId={id(4)} />);
  expect(screen.queryByRole('button', { name: 'Anular venta' })).toBeNull();
});
test('modal exact copy, required labeled input and cancel without mutation', async () => {
  await mount();
  await open();
  expect(
    screen.getByText(
      'Esta acción anula la venta y restituye el stock de los productos. No genera un reembolso.',
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText('Motivo')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Anular venta' })).toBeTruthy();
  await press('Cancelar');
  expect(service.voidSale).not.toHaveBeenCalled();
  expect(uuid.v4).not.toHaveBeenCalled();
});
test.each(['', ' ', '\t\n', '\u00a0'])(
  'reason %j rejected before operation ID/RPC',
  async (reason) => {
    await mount();
    await open();
    await confirm(reason);
    expect(await screen.findByText('Error: Escribe el motivo de la anulación.')).toBeTruthy();
    expect(service.voidSale).not.toHaveBeenCalled();
    expect(uuid.v4).not.toHaveBeenCalled();
  },
);
test('pending freezes payload, disables dismiss/reason and double confirmation; success stays detail', async () => {
  const d = deferred<CorrectionResult<VoidSaleData>>();
  service.voidSale.mockReturnValueOnce(d.promise);
  const view = await mount();
  await open();
  await confirm();
  await waitFor(() => expect(service.voidSale).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Motivo')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
  await press('Anular venta');
  expect(service.voidSale).toHaveBeenCalledTimes(1);
  expect(service.voidSale).toHaveBeenCalledWith(scope.businessId, {
    saleId: id(4),
    operationId: id(71),
    reason: '  Motivo original  ',
  });
  await act(() => d.resolve({ data: corrected(), error: null }));
  await screen.findByText('Venta anulada en BarberFlow');
  expect(screen.getByText('Anulada')).toBeTruthy();
  expect(screen.getByText('Motivo:   Motivo original  ')).toBeTruthy();
  expect(screen.getByText('Stock restituido')).toBeTruthy();
  expect(screen.queryByLabelText('Motivo')).toBeNull();
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  // Privileged result is local; canonical BF197 key remains a normal-RLS read.
  expect(
    view.queryClient.getQueryData(salesKeys.detail({ ...scope, role: 'BARBER' }, id(4))),
  ).toBeUndefined();
});
test.each(['NETWORK_ERROR', 'CONFLICT'] as const)(
  '%s manual retry retains operation ID/reason',
  async (code) => {
    service.voidSale.mockResolvedValueOnce({ data: null, error: saleCorrectionError(code) });
    await mount();
    await open();
    await confirm();
    await screen.findByText(saleCorrectionError(code).message);
    expect(service.voidSale).toHaveBeenCalledTimes(1);
    await press('Anular venta');
    await screen.findByText('Venta anulada en BarberFlow');
    expect(service.voidSale.mock.calls[0]).toEqual(service.voidSale.mock.calls[1]);
    expect(uuid.v4).toHaveBeenCalledTimes(1);
  },
);
test.each(['cancel', 'reason change'])('%s starts a new explicit intent and UUID', async (mode) => {
  service.voidSale.mockResolvedValueOnce({
    data: null,
    error: saleCorrectionError('INVALID_INPUT'),
  });
  await mount();
  await open();
  await confirm();
  await screen.findByText(saleCorrectionError('INVALID_INPUT').message);
  if (mode === 'cancel') {
    await press('Cancelar');
    await open();
  }
  await confirm('Otro motivo');
  await screen.findByText('Venta anulada en BarberFlow');
  expect(service.voidSale.mock.calls[1][1].operationId).not.toBe(
    service.voidSale.mock.calls[0][1].operationId,
  );
  expect(service.voidSale.mock.calls[1][1].reason).toBe('Otro motivo');
});
test.each([
  'ACCESS_DENIED',
  'NOT_FOUND',
  'INVALID_STATUS',
  'INVALID_INPUT',
  'INCOMPLETE_HISTORY',
] as const)('%s safe error and no automatic write retry', async (code) => {
  service.voidSale.mockResolvedValue({ data: null, error: saleCorrectionError(code) });
  await mount();
  await open();
  await confirm();
  await screen.findByText(saleCorrectionError(code).message);
  expect(service.voidSale).toHaveBeenCalledTimes(1);
  if (code === 'INVALID_INPUT')
    expect(screen.getByLabelText('Motivo').props.value).toBe('  Motivo original  ');
  if (['ACCESS_DENIED', 'NOT_FOUND', 'INVALID_STATUS'].includes(code))
    expect(screen.queryByLabelText('Motivo')).toBeNull();
  if (code === 'INVALID_STATUS')
    await waitFor(() => expect(service.getById.mock.calls.length).toBeGreaterThan(1));
});
test('refresh rejection never reverses confirmed success or repeats writer', async () => {
  const view = await mount();
  await open();
  jest.spyOn(view.queryClient, 'invalidateQueries').mockRejectedValue(Error('private refresh'));
  await confirm();
  await screen.findByText('Venta anulada en BarberFlow');
  expect(screen.getByText('Anulada')).toBeTruthy();
  expect(service.voidSale).toHaveBeenCalledTimes(1);
});

test('confirmed void remains visible when normal detail refresh fails', async () => {
  await mount();
  await open();
  service.getById.mockResolvedValue({ data: null, error: saleReadError('NETWORK_ERROR') });
  await confirm();
  await screen.findByText('Venta anulada en BarberFlow');
  await waitFor(() => expect(service.getById.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByText('Anulada')).toBeTruthy();
  expect(service.voidSale).toHaveBeenCalledTimes(1);
});

let latestVoid!: ReturnType<typeof useVoidSale>;
function VoidProbe({ saleId = id(4), eligible = true }: { saleId?: string; eligible?: boolean }) {
  const value = useVoidSale(saleId, { ...current, id: saleId }, eligible);
  useEffect(() => {
    latestVoid = value;
  }, [value]);
  return null;
}
test('successful intent is retired and a held callback cannot create another correction', async () => {
  await renderWithProviders(<VoidProbe />);
  const old = latestVoid.confirm;
  await act(async () => {
    await latestVoid.confirm('  Motivo original  ');
  });
  expect(latestVoid.status).toBe('success');
  await expect(old('Another correction')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  expect(service.voidSale).toHaveBeenCalledTimes(1);
});

test('hook duplicate confirm shares one request and frozen original payload', async () => {
  const d = deferred<CorrectionResult<VoidSaleData>>();
  service.voidSale.mockReturnValueOnce(d.promise);
  await renderWithProviders(<VoidProbe />);
  let first!: Promise<VoidSaleData>, second!: Promise<VoidSaleData>;
  await act(() => {
    first = latestVoid.confirm('  Motivo original  ');
    second = latestVoid.confirm('Changed while pending');
  });
  expect(service.voidSale).toHaveBeenCalledTimes(1);
  await act(async () => {
    d.resolve({ data: corrected(), error: null });
    await Promise.all([first, second]);
  });
  expect(service.voidSale.mock.calls[0][1].reason).toBe('  Motivo original  ');
});
test.each(['user', 'business', 'membership', 'role', 'sale', 'blur', 'unmount', 'logout'])(
  'void stale %s result/retained callback cannot publish or invalidate new scope',
  async (mode) => {
    const d = deferred<CorrectionResult<VoidSaleData>>();
    service.voidSale.mockReturnValueOnce(d.promise);
    const view = await renderWithProviders(<VoidProbe />);
    const staleConfirm = latestVoid.confirm;
    let pending!: Promise<VoidSaleData>;
    await act(() => {
      pending = latestVoid.confirm('  Motivo original  ');
    });
    const outcome = pending.catch((error) => error);
    const invalidation = jest.spyOn(view.queryClient, 'invalidateQueries');
    invalidation.mockClear();
    if (mode === 'user') context(id(91));
    if (mode === 'business') context(scope.userId, id(91));
    if (mode === 'membership') context(scope.userId, scope.businessId, id(91));
    if (mode === 'role') context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
    if (mode === 'blur') mockFocused = false;
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    if (mode === 'unmount') await view.unmount();
    else await view.rerender(<VoidProbe saleId={mode === 'sale' ? id(91) : id(4)} />);
    await act(() => d.resolve({ data: corrected(), error: null }));
    expect((await outcome).code).toBe('ACCESS_DENIED');
    expect(invalidation).not.toHaveBeenCalled();
    await expect(staleConfirm('old callback')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(service.voidSale).toHaveBeenCalledTimes(1);
    if (mode !== 'unmount') expect(latestVoid.status).toBe('idle');
  },
);
test('stale screen success cannot close or replace a new sale modal', async () => {
  const d = deferred<CorrectionResult<VoidSaleData>>();
  service.voidSale.mockReturnValueOnce(d.promise);
  const view = await mount();
  await open();
  await confirm();
  current = { ...detail(), id: id(90) };
  await view.rerender(<SaleDetailScreen saleId={id(90)} />);
  await open();
  await fireEvent.changeText(screen.getByLabelText('Motivo'), 'New intent');
  await act(() => d.resolve({ data: corrected(), error: null }));
  expect(screen.getByLabelText('Motivo').props.value).toBe('New intent');
  expect(screen.queryByText('Venta anulada en BarberFlow')).toBeNull();
});
let latestCorrection!: ReturnType<typeof useSaleCorrectionDetail>;
function CorrectionProbe() {
  const value = useSaleCorrectionDetail(current);
  useEffect(() => {
    latestCorrection = value;
  }, [value]);
  return null;
}
test('correction stale OWNER response is hidden after role downgrade', async () => {
  current.status = 'VOIDED';
  const d = deferred<CorrectionResult<SaleCorrectionData>>();
  service.getCorrectionDetail.mockReturnValueOnce(d.promise);
  const view = await renderWithProviders(<CorrectionProbe />);
  context(scope.userId, scope.businessId, scope.membershipId, 'BARBER');
  await view.rerender(<CorrectionProbe />);
  await act(() => d.resolve({ data: corrected(), error: null }));
  expect(latestCorrection.status).toBe('idle');
  expect(latestCorrection.data).toBeNull();
});
