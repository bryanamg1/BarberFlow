import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { useState } from 'react';

import { AppointmentClientSelector } from '@/features/appointments/components/AppointmentClientSelector';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { clientsService } from '@/features/clients/services/clientsService';
import type { ClientListResult, ClientResult } from '@/features/clients/types/client.types';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/services/clientsService', () => ({
  clientsService: {
    list: jest.fn(),
    search: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Selector imported Supabase');
});
const businessMock = jest.mocked(useBusiness);
const service = jest.mocked(clientsService);
const business = (id = 'b', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'm',
    role,
    business: {
      id,
      name: 'Demo',
      currency_code: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
});
const row = (patch: Partial<ClientRow> = {}): ClientRow => ({
  id: 'c',
  business_id: 'b',
  first_name: 'Martín',
  last_name: 'Pérez',
  phone: 'private-phone',
  email: 'private-email',
  instagram: 'private-social',
  birth_date: '2000-01-01',
  notes: 'private-note',
  preferences: 'private-preference',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...patch,
});
const page = (items = [row()], number = 1, hasNextPage = false): ClientListResult => ({
  data: { items, page: number, pageSize: 25, hasNextPage },
  error: null,
});
const failure: ClientListResult = {
  data: null,
  error: { code: 'NETWORK_ERROR', message: 'No pudimos cargar los clientes.' },
};
const input = () => screen.getByLabelText('Buscar clientes');
const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));
const change = (text: string) => fireEvent.changeText(input(), text);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function Controlled({
  initial = null,
  onChange = jest.fn(),
}: {
  initial?: string | null;
  onChange?: (id: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AppointmentClientSelector
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler(defaultScheduler));
beforeEach(() => {
  businessMock.mockReturnValue(business());
  service.list.mockResolvedValue(page());
  service.search.mockResolvedValue(page([row({ id: 'd', first_name: 'Diego', last_name: null })]));
  service.getById.mockResolvedValue({ data: row(), error: null });
});
afterEach(() => {
  expect(service.create).not.toHaveBeenCalled();
  expect(service.update).not.toHaveBeenCalled();
});

test('loads the active scoped page and exposes no selection', async () => {
  await renderWithProviders(<Controlled />);
  expect(
    await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' }),
  ).toBeTruthy();
  expect(service.list).toHaveBeenCalledWith('b', { page: 1, pageSize: 25, status: 'active' });
  expect(screen.getByText('Sin cliente seleccionado')).toBeTruthy();
  expect(service.getById).not.toHaveBeenCalled();
  expect(service.search).not.toHaveBeenCalled();
});
test('loading does not expose stale choices or paging controls', async () => {
  service.list.mockReturnValue(deferred<ClientListResult>().promise);
  await renderWithProviders(<Controlled />);
  expect(screen.getByText('Cargando clientes…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
});
test('empty is a successful state without client creation', async () => {
  service.list.mockResolvedValue(page([]));
  await renderWithProviders(<Controlled />);
  expect(await screen.findByText('No hay clientes activos para seleccionar.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Crear/ })).toBeNull();
});
test('safe read error can be retried', async () => {
  service.list.mockResolvedValueOnce(failure).mockResolvedValue(page());
  await renderWithProviders(<Controlled />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(failure.error!.message)).toBeTruthy();
  await press('Reintentar');
  expect(
    await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' }),
  ).toBeTruthy();
  expect(service.list).toHaveBeenCalledTimes(2);
});
test.each(['OWNER', 'BARBER'] as const)('%s can choose an exact client ID', async (role) => {
  businessMock.mockReturnValue(business('b', role));
  const onChange = jest.fn();
  await renderWithProviders(<Controlled onChange={onChange} />);
  await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' });
  await press('Seleccionar cliente: Martín Pérez');
  expect(onChange).toHaveBeenCalledWith('c');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Cliente seleccionado: Martín Pérez')).toBeTruthy();
});
test('parent remains the source of selection and can replace it', async () => {
  const onChange = jest.fn();
  const { rerender } = await renderWithProviders(
    <AppointmentClientSelector value={null} onChange={onChange} />,
  );
  await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' });
  await press('Seleccionar cliente: Martín Pérez');
  expect(screen.getByText('Sin cliente seleccionado')).toBeTruthy();
  await rerender(<AppointmentClientSelector value="c" onChange={onChange} />);
  expect(await screen.findByText('Cliente seleccionado: Martín Pérez')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Seleccionar cliente: Martín Pérez' })).toBeDisabled();
  await rerender(<AppointmentClientSelector value={null} onChange={onChange} />);
  expect(screen.getByText('Sin cliente seleccionado')).toBeTruthy();
  expect(onChange).toHaveBeenCalledTimes(1);
});
test('archived historical selection is retained read-only until explicit replacement', async () => {
  service.getById.mockImplementation(async (_businessId, id) => ({
    data: id === 'old' ? row({ id: 'old', first_name: 'Valentina', is_active: false }) : row(),
    error: null,
  }));
  const onChange = jest.fn();
  await renderWithProviders(<Controlled initial="old" onChange={onChange} />);
  expect(await screen.findByText('Cliente seleccionado: Valentina Pérez')).toBeTruthy();
  expect(screen.getByText('Archivado')).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Valentina/ })).toBeNull();
  await press('Seleccionar cliente: Martín Pérez');
  expect(onChange).toHaveBeenCalledWith('c');
  expect(await screen.findByText('Cliente seleccionado: Martín Pérez')).toBeTruthy();
  expect(screen.queryByText('Archivado')).toBeNull();
});
test('unavailable selected detail is not silently cleared or claimed physically absent', async () => {
  service.getById.mockResolvedValue({
    data: null,
    error: { code: 'CLIENT_NOT_FOUND', message: 'Cliente no disponible.' },
  });
  const onChange = jest.fn();
  await renderWithProviders(<Controlled initial="hidden" onChange={onChange} />);
  expect(await screen.findByText('Cliente seleccionado no disponible')).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
test('short or blank terms use list, and >=2 uses literal trimmed server search', async () => {
  await renderWithProviders(<Controlled />);
  await screen.findByText('Página 1');
  await change(' x ');
  expect(service.search).not.toHaveBeenCalled();
  await change('  %,_(.)  ');
  expect(await screen.findByRole('button', { name: 'Seleccionar cliente: Diego' })).toBeTruthy();
  expect(service.search).toHaveBeenCalledWith('b', {
    term: '%,_(.)',
    page: 1,
    pageSize: 25,
    status: 'active',
  });
  await change(' ');
  expect(
    await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' }),
  ).toBeTruthy();
});
test('search preserves selected client outside the current results', async () => {
  const onChange = jest.fn();
  await renderWithProviders(<Controlled initial="c" onChange={onChange} />);
  await screen.findByText('Cliente seleccionado: Martín Pérez');
  await change('Diego');
  await screen.findByRole('button', { name: 'Seleccionar cliente: Diego' });
  expect(screen.getByText('Cliente seleccionado: Martín Pérez')).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
test('pagination is bounded and search changes reset to page one', async () => {
  service.list.mockImplementation(async (_id, params) =>
    page([row({ id: `p${params?.page}` })], params?.page, params?.page === 1),
  );
  await renderWithProviders(<Controlled />);
  await screen.findByText('Página 1');
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await press('Siguiente');
  await screen.findByText('Página 2');
  expect(service.list).toHaveBeenLastCalledWith('b', { page: 2, pageSize: 25, status: 'active' });
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await change('Di');
  await screen.findByText('Página 1');
  expect(service.search).toHaveBeenLastCalledWith('b', {
    term: 'Di',
    page: 1,
    pageSize: 25,
    status: 'active',
  });
});
test('duplicate IDs render once; archived and foreign choices are never selectable', async () => {
  service.list.mockResolvedValue(
    page([
      row(),
      row(),
      row({ id: 'archived', is_active: false }),
      row({ id: 'foreign', business_id: 'other' }),
    ]),
  );
  await renderWithProviders(<Controlled />);
  await screen.findByRole('button', { name: 'Seleccionar cliente: Martín Pérez' });
  expect(screen.getAllByRole('button', { name: /Seleccionar cliente:/ })).toHaveLength(1);
});
test('only names are displayed, without unnecessary contact or private metadata', async () => {
  await renderWithProviders(<Controlled initial="c" />);
  await screen.findByText('Cliente seleccionado: Martín Pérez');
  for (const text of [
    'private-phone',
    'private-email',
    'private-social',
    'private-note',
    'private-preference',
    '2000-01-01',
  ])
    expect(screen.queryByText(text)).toBeNull();
  expect(input()).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Cliente' })).toBeTruthy();
});
test('tenant transition clears parent draft selection and resets search/page controls', async () => {
  const onChange = jest.fn();
  const { rerender } = await renderWithProviders(<Controlled initial="c" onChange={onChange} />);
  await screen.findByText('Cliente seleccionado: Martín Pérez');
  await change('Diego');
  await screen.findByRole('button', { name: 'Seleccionar cliente: Diego' });
  businessMock.mockReturnValue(business('other'));
  service.list.mockResolvedValue(page([row({ business_id: 'other', first_name: 'Lucía' })]));
  await rerender(<Controlled initial="c" onChange={onChange} />);
  expect(onChange).toHaveBeenCalledWith(null);
  expect(input()).toHaveProp('value', '');
  expect(screen.queryByText('Cliente seleccionado: Martín Pérez')).toBeNull();
  expect(
    await screen.findByRole('button', { name: 'Seleccionar cliente: Lucía Pérez' }),
  ).toBeTruthy();
  expect(service.list).toHaveBeenLastCalledWith('other', {
    page: 1,
    pageSize: 25,
    status: 'active',
  });
});
test('late search response cannot overwrite a newer search', async () => {
  const old = deferred<ClientListResult>();
  service.search.mockImplementation((_id, params) =>
    params.term === 'old' ? old.promise : Promise.resolve(page([row({ first_name: 'Lucía' })])),
  );
  await renderWithProviders(<Controlled />);
  await screen.findByText('Página 1');
  await change('old');
  await waitFor(() => expect(service.search).toHaveBeenCalled());
  await change('new');
  await screen.findByRole('button', { name: 'Seleccionar cliente: Lucía Pérez' });
  await act(async () => old.resolve(page([row({ first_name: 'Obsoleto' })])));
  expect(screen.queryByRole('button', { name: /Obsoleto/ })).toBeNull();
});
test('late tenant A read cannot render in tenant B', async () => {
  const old = deferred<ClientListResult>();
  service.list.mockImplementation((id) =>
    id === 'b'
      ? old.promise
      : Promise.resolve(page([row({ business_id: 'other', first_name: 'Lucía' })])),
  );
  const { rerender } = await renderWithProviders(<Controlled />);
  businessMock.mockReturnValue(business('other'));
  await rerender(<Controlled />);
  await screen.findByRole('button', { name: 'Seleccionar cliente: Lucía Pérez' });
  await act(async () => old.resolve(page()));
  expect(screen.queryByRole('button', { name: 'Seleccionar cliente: Martín Pérez' })).toBeNull();
});
test.each(['idle', 'pending', 'error'] as const)(
  'business %s disables all client reads',
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
    await renderWithProviders(<Controlled initial="c" />);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.getById).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Buscar clientes')).toBeNull();
  },
);
test('access denial exposes the existing safe domain message', async () => {
  service.list.mockResolvedValue({
    data: null,
    error: { code: 'CLIENT_ACCESS_DENIED', message: 'No tienes acceso a los clientes.' },
  });
  await renderWithProviders(<Controlled />);
  expect(await screen.findByText('No tienes acceso a los clientes.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Seleccionar cliente:/ })).toBeNull();
});
