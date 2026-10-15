import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { useState } from 'react';

import { AppointmentServiceSelector } from '@/features/appointments/components/AppointmentServiceSelector';
import {
  createAppointmentItemSchema,
  type CreateAppointmentItemInput,
} from '@/features/appointments/schemas/appointment.schema';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { servicesService } from '@/features/services/services/servicesService';
import type { ServiceListResult, ServiceResult } from '@/features/services/types/service.types';
import { createTestQueryClient } from '@/test/createTestQueryClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { formatCatalogPrice, formatMoney } from '@/utils/formatMoney';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/services/servicesService', () => ({
  servicesService: {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Selector imported Supabase');
});
jest.mock('@/features/appointments/repositories/appointmentsRepository', () => {
  throw new Error('Selector imported appointment persistence');
});
const businessMock = jest.mocked(useBusiness);
const service = jest.mocked(servicesService);
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  data: {
    membershipId: 'm',
    role,
    business: { id, name: 'Demo', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
  error: null,
  isFetching: false,
});
const row = (patch: Partial<ServiceRow> = {}): ServiceRow => ({
  id: 's1',
  business_id: 'b',
  name: 'Corte',
  description: 'private description',
  price: 10000,
  duration_minutes: 30,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...patch,
});
const item = (serviceId = 's1', quantity = 1): CreateAppointmentItemInput => ({
  serviceId,
  quantity,
});
const page = (items = [row()], number = 1, hasNextPage = false): ServiceListResult => ({
  data: { items, page: number, pageSize: 25, hasNextPage },
  error: null,
});
const fail: ServiceResult = {
  data: null,
  error: { code: 'NETWORK_ERROR', message: 'No pudimos cargar el servicio.' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));
function Controlled({
  initial = [],
  onChange = jest.fn(),
}: {
  initial?: CreateAppointmentItemInput[];
  onChange?: (items: CreateAppointmentItemInput[]) => void;
}) {
  const [items, setItems] = useState(initial);
  return (
    <AppointmentServiceSelector
      items={items}
      onChange={(next) => {
        setItems(next);
        onChange(next);
      }}
    />
  );
}
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler(defaultScheduler));
beforeEach(() => {
  businessMock.mockReturnValue(business());
  service.list.mockResolvedValue(page());
  service.getById.mockImplementation(async (businessId, id) => ({
    data: row({ id, business_id: businessId, name: id === 's2' ? 'Barba' : 'Corte' }),
    error: null,
  }));
});
afterEach(() => {
  expect(service.create).not.toHaveBeenCalled();
  expect(service.update).not.toHaveBeenCalled();
});

test('loads the existing active page without search or implicit selection', async () => {
  const onChange = jest.fn();
  await renderWithProviders(<Controlled onChange={onChange} />);
  expect(await screen.findByRole('button', { name: 'Agregar servicio: Corte' })).toBeTruthy();
  expect(service.list).toHaveBeenCalledWith('b', { page: 1, pageSize: 25, status: 'active' });
  expect(service.getById).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('Sin servicios seleccionados')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
test('loading does not expose old choices or paging controls', async () => {
  service.list.mockReturnValue(deferred<ServiceListResult>().promise);
  await renderWithProviders(<Controlled />);
  expect(screen.getByText('Cargando servicios…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
});
test('empty catalog is distinct from failure and offers no administration shortcut', async () => {
  service.list.mockResolvedValue(page([]));
  await renderWithProviders(<Controlled />);
  expect(await screen.findByText('No hay servicios activos para seleccionar.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: /Crear/ })).toBeNull();
});
test('safe list error can be retried', async () => {
  service.list.mockResolvedValueOnce(fail).mockResolvedValue(page());
  await renderWithProviders(<Controlled />);
  expect(await screen.findByText(fail.error!.message)).toBeTruthy();
  await press('Reintentar');
  expect(await screen.findByRole('button', { name: 'Agregar servicio: Corte' })).toBeTruthy();
  expect(service.list).toHaveBeenCalledTimes(2);
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s chooses only the approved ID/quantity DTO',
  async (role) => {
    businessMock.mockReturnValue(business('b', role));
    const onChange = jest.fn();
    await renderWithProviders(<Controlled onChange={onChange} />);
    await screen.findByRole('button', { name: 'Agregar servicio: Corte' });
    await press('Agregar servicio: Corte');
    expect(onChange).toHaveBeenCalledWith([item()]);
    expect(await screen.findByText('Servicio seleccionado (línea 1): Corte')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar servicio: Corte' })).toBeDisabled();
  },
);
test('parent owns selection; the component does not mirror it', async () => {
  const onChange = jest.fn();
  const { rerender } = await renderWithProviders(
    <AppointmentServiceSelector items={[]} onChange={onChange} />,
  );
  await screen.findByRole('button', { name: 'Agregar servicio: Corte' });
  await press('Agregar servicio: Corte');
  expect(screen.getByText('Sin servicios seleccionados')).toBeTruthy();
  await rerender(<AppointmentServiceSelector items={[item()]} onChange={onChange} />);
  expect(await screen.findByText('Servicio seleccionado (línea 1): Corte')).toBeTruthy();
  expect(onChange).toHaveBeenCalledTimes(1);
});
test('multiple selection appends in order and deselection removes only the requested line', async () => {
  service.list.mockResolvedValue(page([row({ id: 's2', name: 'Barba' }), row()]));
  const onChange = jest.fn();
  await renderWithProviders(<Controlled onChange={onChange} />);
  await screen.findByRole('button', { name: 'Agregar servicio: Barba' });
  await press('Agregar servicio: Barba');
  await press('Agregar servicio: Corte');
  expect(onChange).toHaveBeenLastCalledWith([item('s2'), item()]);
  await press('Quitar servicio de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([item()]);
  await press('Quitar servicio de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([]);
});
test('existing duplicate lines are preserved, not silently deduplicated or merged', async () => {
  const onChange = jest.fn();
  await renderWithProviders(
    <Controlled initial={[item('s1', 2), item('s1', 3)]} onChange={onChange} />,
  );
  await screen.findByText('Servicio seleccionado (línea 2): Corte');
  expect(onChange).not.toHaveBeenCalled();
  await press('Aumentar cantidad de línea 2');
  expect(onChange).toHaveBeenLastCalledWith([item('s1', 2), item('s1', 4)]);
  await press('Quitar servicio de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([item('s1', 4)]);
});
test('quantity is numeric, positive and bounded only by the existing schema', async () => {
  const onChange = jest.fn();
  const { rerender } = await renderWithProviders(
    <AppointmentServiceSelector items={[item()]} onChange={onChange} />,
  );
  await screen.findByText('Servicio seleccionado (línea 1): Corte');
  expect(screen.getByRole('button', { name: 'Reducir cantidad de línea 1' })).toBeDisabled();
  await press('Aumentar cantidad de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([item('s1', 2)]);
  await rerender(
    <AppointmentServiceSelector items={[item('s1', 2147483647)]} onChange={onChange} />,
  );
  expect(screen.getByRole('button', { name: 'Aumentar cantidad de línea 1' })).toBeDisabled();
  await press('Reducir cantidad de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([item('s1', 2147483646)]);
  expect(createAppointmentItemSchema.safeParse(onChange.mock.calls.at(-1)![0][0]).success).toBe(
    true,
  );
});
test.each([0, -1, 1.5, 2147483648])(
  'invalid caller quantity %s is not silently coerced',
  async (quantity) => {
    const onChange = jest.fn();
    await renderWithProviders(<Controlled initial={[item('s1', quantity)]} onChange={onChange} />);
    await screen.findByText('Servicio seleccionado (línea 1): Corte');
    expect(screen.getByText('Cantidad no válida.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aumentar cantidad de línea 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reducir cantidad de línea 1' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  },
);
test('archive after selection preserves the line, marks it unavailable and never manufactures a snapshot', async () => {
  const queryClient = createTestQueryClient(),
    onChange = jest.fn();
  await renderWithProviders(<Controlled initial={[item('s1', 2)]} onChange={onChange} />, {
    queryClient,
  });
  await screen.findByText('Servicio seleccionado (línea 1): Corte');
  service.getById.mockResolvedValue({ data: row({ is_active: false }), error: null });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: servicesKeys.detail('b', 's1'), exact: true });
  });
  expect(await screen.findByText('Archivado')).toBeTruthy();
  expect(screen.getByText('Cantidad: 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Aumentar cantidad de línea 1' })).toBeDisabled();
  expect(screen.queryByText(/Estimación de catálogo de esta línea:/)).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  await press('Quitar servicio de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([]);
});
test('selected detail remains visible independently of the catalog page', async () => {
  service.list.mockResolvedValue(page([], 1, true));
  await renderWithProviders(<Controlled initial={[item('s2', 2)]} />);
  expect(await screen.findByText('Servicio seleccionado (línea 1): Barba')).toBeTruthy();
  await press('Siguiente');
  await waitFor(() =>
    expect(service.list).toHaveBeenLastCalledWith('b', { page: 2, pageSize: 25, status: 'active' }),
  );
  expect(screen.getByText('Servicio seleccionado (línea 1): Barba')).toBeTruthy();
});
test('invisible selected service stays in the parent draft with safe retry/removal', async () => {
  service.getById.mockResolvedValue(fail);
  const onChange = jest.fn();
  await renderWithProviders(<Controlled initial={[item()]} onChange={onChange} />);
  expect(await screen.findByText(fail.error!.message)).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Aumentar cantidad de línea 1' })).toBeDisabled();
  await press('Quitar servicio de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([]);
});
test('selected loading disables quantity changes but allows explicit removal', async () => {
  service.getById.mockReturnValue(deferred<ServiceResult>().promise);
  await renderWithProviders(<Controlled initial={[item()]} />);
  expect(screen.getByText('Cargando servicio seleccionado…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Aumentar cantidad de línea 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Quitar servicio de línea 1' })).toBeEnabled();
});
test('catalog displays name/price/duration, excludes foreign/archive/duplicates and internal fields', async () => {
  service.list.mockResolvedValue(
    page([
      row(),
      row(),
      row({ id: 'old', is_active: false }),
      row({ id: 'foreign', business_id: 'other' }),
    ]),
  );
  await renderWithProviders(<Controlled />);
  await screen.findByRole('button', { name: 'Agregar servicio: Corte' });
  expect(screen.getAllByRole('button', { name: /Agregar servicio:/ })).toHaveLength(1);
  expect(
    screen.getByText(`${formatCatalogPrice(10000, 'ARS')} · 30 minutos por unidad`),
  ).toBeTruthy();
  expect(screen.queryByText('private description')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Servicios' })).toBeTruthy();
});
test('estimates use exact cents for decimal prices and very large valid quantities', async () => {
  service.getById.mockResolvedValue({ data: row({ price: 0.29 }), error: null });
  const { rerender } = await renderWithProviders(<Controlled initial={[item('s1', 3)]} />);
  expect(
    await screen.findByText(`Estimación de catálogo de esta línea: ${formatMoney('0.87', 'ARS')}`),
  ).toBeTruthy();
  service.getById.mockResolvedValue({ data: row({ id: 's2', price: 9999999999.99 }), error: null });
  await rerender(
    <AppointmentServiceSelector items={[item('s2', 2147483647)]} onChange={jest.fn()} />,
  );
  expect(
    await screen.findByText(
      `Estimación de catálogo de esta línea: ${formatMoney('21474836469978525163.53', 'ARS')}`,
    ),
  ).toBeTruthy();
});
test('onChange strips extra caller fields and never trusts UI price or snapshot data', async () => {
  const onChange = jest.fn();
  const decorated = {
    ...item(),
    unit_price_snapshot: 1,
    duration_minutes_snapshot: 999,
    price: 0,
    business_id: 'foreign',
  };
  await renderWithProviders(<Controlled initial={[decorated]} onChange={onChange} />);
  await screen.findByText('Servicio seleccionado (línea 1): Corte');
  await press('Aumentar cantidad de línea 1');
  expect(onChange).toHaveBeenLastCalledWith([item('s1', 2)]);
});
test('page controls use the existing sentinel and preserve selection on navigation', async () => {
  service.list.mockImplementation(async (_businessId, params) =>
    page([row({ id: `p${params?.page}` })], params?.page, params?.page === 1),
  );
  await renderWithProviders(<Controlled initial={[item('s2')]} />);
  await screen.findByText('Página 1');
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await press('Siguiente');
  await screen.findByText('Página 2');
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  expect(screen.getByText('Servicio seleccionado (línea 1): Barba')).toBeTruthy();
  await press('Anterior');
  await screen.findByText('Página 1');
});
test('tenant change clears parent items and resets pagination', async () => {
  service.list.mockResolvedValue(page([row()], 1, true));
  const onChange = jest.fn();
  const { rerender } = await renderWithProviders(
    <Controlled initial={[item()]} onChange={onChange} />,
  );
  await screen.findByText('Servicio seleccionado (línea 1): Corte');
  await press('Siguiente');
  await waitFor(() =>
    expect(service.list).toHaveBeenCalledWith('b', { page: 2, pageSize: 25, status: 'active' }),
  );
  businessMock.mockReturnValue(business('other'));
  service.list.mockResolvedValue(page([row({ business_id: 'other', name: 'Nuevo catálogo' })]));
  await rerender(<Controlled initial={[item()]} onChange={onChange} />);
  expect(onChange).toHaveBeenLastCalledWith([]);
  expect(screen.queryByText('Servicio seleccionado (línea 1): Corte')).toBeNull();
  expect(
    await screen.findByRole('button', { name: 'Agregar servicio: Nuevo catálogo' }),
  ).toBeTruthy();
  expect(service.list).toHaveBeenLastCalledWith('other', {
    page: 1,
    pageSize: 25,
    status: 'active',
  });
});
test('late tenant A responses cannot render in B', async () => {
  const old = deferred<ServiceListResult>();
  service.list.mockImplementation((id) =>
    id === 'b'
      ? old.promise
      : Promise.resolve(page([row({ business_id: 'other', name: 'Nuevo catálogo' })])),
  );
  const { rerender } = await renderWithProviders(<Controlled />);
  businessMock.mockReturnValue(business('other'));
  await rerender(<Controlled />);
  await screen.findByRole('button', { name: 'Agregar servicio: Nuevo catálogo' });
  await act(async () => old.resolve(page()));
  expect(screen.queryByRole('button', { name: 'Agregar servicio: Corte' })).toBeNull();
});
test.each(['idle', 'pending', 'error'] as const)(
  'business %s does not enable service reads',
  async (status) => {
    const context: BusinessContextValue =
      status === 'error'
        ? {
            status,
            data: null,
            error: { code: 'BUSINESS_ACCESS_DENIED', message: 'Negocio no disponible.' },
            isFetching: false,
          }
        : status === 'idle'
          ? { status, data: null, error: null, isFetching: false }
          : { status, data: null, error: null, isFetching: true };
    businessMock.mockReturnValue(context);
    await renderWithProviders(<Controlled initial={[item()]} />);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.getById).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Agregar servicio:/ })).toBeNull();
  },
);
test('failed selected-detail refetch hides the stale estimate', async () => {
  const queryClient = createTestQueryClient();
  await renderWithProviders(<Controlled initial={[item()]} />, { queryClient });
  await screen.findByText(/Estimación de catálogo de esta línea:/);
  service.getById.mockResolvedValue(fail);
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: servicesKeys.detail('b', 's1'), exact: true });
  });
  expect(await screen.findByText(fail.error!.message)).toBeTruthy();
  expect(screen.queryByText(/Estimación de catálogo de esta línea:/)).toBeNull();
});
