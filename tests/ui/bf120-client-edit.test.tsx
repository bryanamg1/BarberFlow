import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import EditRoute from '@/app/(app)/clients/[id]/edit';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import {
  useClientDetail,
  type UseClientDetailResult,
} from '@/features/clients/hooks/useClientDetail';
import { useUpdateClient } from '@/features/clients/hooks/useUpdateClient';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { ClientEditScreen } from '@/features/clients/screens/ClientEditScreen';
import type { ClientServiceError } from '@/features/clients/types/client.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/hooks/useClientDetail', () => ({ useClientDetail: jest.fn() }));
jest.mock('@/features/clients/hooks/useUpdateClient', () => ({ useUpdateClient: jest.fn() }));
jest.mock('@/features/clients/hooks/useCreateClient', () => ({ useCreateClient: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
// Native inset events are unavailable in Jest; keep the actual overlay and its controls.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => {
  const { routerMock } =
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils');
  return { router: { ...routerMock, canGoBack: jest.fn() }, useLocalSearchParams: jest.fn() };
});

const businessMock = jest.mocked(useBusiness);
const detailMock = jest.mocked(useClientDetail);
const mutationMock = jest.mocked(useUpdateClient);
const paramsMock = jest.mocked(useLocalSearchParams);
const canGoBackMock = jest.mocked(router.canGoBack);
type UpdateVariables = Parameters<ReturnType<typeof useUpdateClient>['mutateAsync']>[0];
const mutateCall = jest.fn<Promise<ClientRow>, [UpdateVariables]>();
const resetCall = jest.fn();
const business = (id = 'business-a'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'membership',
    role: 'BARBER',
    business: {
      id,
      name: 'Test business',
      currency_code: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
});
const client: ClientRow = {
  id: 'client-a',
  business_id: 'business-a',
  first_name: 'Martín',
  last_name: 'Pérez',
  phone: 'Interno X',
  email: 'Texto libre',
  instagram: 'Cuenta libre',
  birth_date: '2000-02-29',
  notes: 'Primera línea\nSegunda línea',
  preferences: 'Sin perfume',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};
const updated = { ...client, id: 'returned-client-id', first_name: 'Nuevo' };
const success = (data = client, isFetching = false): UseClientDetailResult => ({
  status: 'success',
  data,
  error: null,
  isFetching,
});
const idle: UseClientDetailResult = { status: 'idle', data: null, error: null, isFetching: false };
const pending: UseClientDetailResult = {
  status: 'pending',
  data: null,
  error: null,
  isFetching: true,
};
type MutationState =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ClientRow; error: null }
  | { status: 'error'; data: null; error: ClientServiceError };
function useTestMutation(): ReturnType<typeof useUpdateClient> {
  const [state, setState] = useState<MutationState>({ status: 'idle', data: null, error: null });
  return {
    ...state,
    reset: () => {
      resetCall();
      setState({ status: 'idle', data: null, error: null });
    },
    mutateAsync: async (variables) => {
      setState({ status: 'pending', data: null, error: null });
      try {
        const data = await mutateCall(variables);
        setState({ status: 'success', data, error: null });
        return data;
      } catch (error) {
        setState({ status: 'error', data: null, error: error as ClientServiceError });
        throw error;
      }
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const input = (label: string) => screen.getByLabelText(label);
const change = (label: string, value: string) => fireEvent.changeText(input(label), value);
const press = (label: string) => userEvent.press(screen.getByRole('button', { name: label }));
const save = () => press('Guardar cambios');
const labels = [
  'Nombre (obligatorio)',
  'Apellido',
  'Teléfono',
  'Email',
  'Instagram',
  'Fecha de nacimiento',
  'Notas',
  'Preferencias',
];
const assertPatch = (patch: UpdateVariables['input'], id = 'client-a') => {
  expect(mutateCall).toHaveBeenCalledTimes(1);
  expect(mutateCall).toHaveBeenCalledWith({ clientId: id, input: patch });
};
beforeEach(() => {
  resetRouterMocks();
  businessMock.mockReturnValue(business());
  detailMock.mockReset().mockImplementation((id) => (id === null ? idle : success()));
  mutationMock.mockReset().mockImplementation(useTestMutation);
  paramsMock.mockReturnValue({ id: 'client-a' });
  canGoBackMock.mockReturnValue(true);
  mutateCall.mockReset().mockResolvedValue(updated);
  resetCall.mockReset();
});

test('route initializes eight labeled text fields and active state, excluding managed fields', async () => {
  await renderWithProviders(<EditRoute />);
  expect(screen.getByRole('heading', { name: 'Editar cliente' })).toBeOnTheScreen();
  const values = [
    'Martín',
    'Pérez',
    'Interno X',
    'Texto libre',
    'Cuenta libre',
    '2000-02-29',
    client.notes,
    client.preferences,
  ];
  labels.forEach((label, index) => expect(input(label)).toHaveProp('value', values[index]));
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  expect(input('Notas')).toHaveProp('multiline', true);
  expect(input('Preferencias')).toHaveProp('multiline', true);
  expect(input('Teléfono')).toHaveProp('keyboardType', 'phone-pad');
  expect(input('Email')).toHaveProp('keyboardType', 'email-address');
  for (const label of ['ID', 'business_id', 'created_at', 'updated_at'])
    expect(screen.queryByLabelText(label)).toBeNull();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  expect(mutateCall).not.toHaveBeenCalled();
});

test.each([undefined, '', '  ', [], ['client-a'], ['client-a', 'client-b']])(
  'unusable param %j does not show a form',
  async (id) => {
    paramsMock.mockReturnValue(id === undefined ? {} : { id });
    await renderWithProviders(<EditRoute />);
    expect(detailMock).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('status', { name: 'Cliente no disponible' })).toBeOnTheScreen();
    expect(screen.queryByLabelText(labels[0])).toBeNull();
    expect(mutationMock).not.toHaveBeenCalled();
  },
);

test('scalar route id is preserved without trimming or UUID validation', async () => {
  paramsMock.mockReturnValue({ id: '  original-id  ' });
  await renderWithProviders(<EditRoute />);
  await change(labels[0], 'Nuevo');
  await save();
  expect(detailMock).toHaveBeenLastCalledWith('  original-id  ');
  assertPatch({ first_name: 'Nuevo' }, '  original-id  ');
});

test('pending becomes initialized success asynchronously, never an empty draft', async () => {
  detailMock.mockReturnValue(pending);
  const rendered = await renderWithProviders(<EditRoute />);
  expect(screen.getByRole('progressbar', { name: 'Cargando cliente…' })).toBeOnTheScreen();
  expect(screen.queryByLabelText(labels[0])).toBeNull();
  detailMock.mockReturnValue(success());
  await rendered.rerender(<EditRoute />);
  expect(input(labels[0])).toHaveProp('value', 'Martín');
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
});

test.each(['CLIENT_NOT_FOUND', 'NETWORK_ERROR', 'CLIENT_ACCESS_DENIED', 'UNKNOWN_ERROR'] as const)(
  'initial %s exposes safe error, never a form',
  async (code) => {
    detailMock.mockReturnValue({
      status: 'error',
      data: null,
      error: { code, message: 'Mensaje seguro' },
      isFetching: false,
    });
    await renderWithProviders(<EditRoute />);
    expect(screen.getByText('Mensaje seguro')).toBeOnTheScreen();
    if (code === 'CLIENT_NOT_FOUND')
      expect(screen.getByRole('status', { name: /^Cliente no encontrado/ })).toBeOnTheScreen();
    expect(screen.queryByLabelText(labels[0])).toBeNull();
    expect(mutationMock).not.toHaveBeenCalled();
  },
);

test('read retry invalidates only the current detail key', async () => {
  detailMock.mockReturnValue({
    status: 'error',
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
    isFetching: false,
  });
  const rendered = await renderWithProviders(<EditRoute />);
  const invalidate = jest.spyOn(rendered.queryClient, 'invalidateQueries');
  await press('Reintentar');
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: clientsKeys.detail('business-a', 'client-a'),
    exact: true,
  });
  detailMock.mockReturnValue({
    status: 'error',
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
    isFetching: true,
  });
  await rendered.rerender(<EditRoute />);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
});

test('unchanged and reverted fields cannot issue an empty update', async () => {
  await renderWithProviders(<EditRoute />);
  await save();
  await change(labels[0], 'Otro');
  await change(labels[0], 'Martín');
  await save();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  expect(mutateCall).not.toHaveBeenCalled();
});

test('name PATCH preserves surrounding whitespace and omits all unchanged values', async () => {
  await renderWithProviders(<EditRoute />);
  await change(labels[0], '  Nuevo  ');
  await save();
  assertPatch({ first_name: '  Nuevo  ' });
});

test.each(['', '   '])(
  'changed invalid name %j is rejected by the existing schema',
  async (value) => {
    await renderWithProviders(<EditRoute />);
    await change(labels[0], value);
    await save();
    expect(await screen.findByText('Error: Ingresa el nombre.')).toBeOnTheScreen();
    expect(input(labels[0])).toHaveProp('value', value);
    expect(mutateCall).not.toHaveBeenCalled();
  },
);

test('multiple edited text fields preserve exact free text and include no managed fields', async () => {
  await renderWithProviders(<EditRoute />);
  await change('Teléfono', '  interno sin formato  ');
  await change('Email', '  sin arroba  ');
  await change('Instagram', '  cuenta libre  ');
  await change('Notas', '  nota\n  siguiente  ');
  await change('Preferencias', '  sin cambios de formato  ');
  await save();
  assertPatch({
    phone: '  interno sin formato  ',
    email: '  sin arroba  ',
    instagram: '  cuenta libre  ',
    notes: '  nota\n  siguiente  ',
    preferences: '  sin cambios de formato  ',
  });
});

test('initial nulls show empty and remain absent from a name-only PATCH', async () => {
  detailMock.mockReturnValue(
    success({
      ...client,
      last_name: null,
      phone: null,
      email: null,
      instagram: null,
      birth_date: null,
      notes: null,
      preferences: null,
    }),
  );
  await renderWithProviders(<EditRoute />);
  labels.slice(1).forEach((label) => expect(input(label)).toHaveProp('value', ''));
  await change(labels[0], 'Nuevo');
  await save();
  assertPatch({ first_name: 'Nuevo' });
});

test('typing then clearing an initially null text field sends empty string explicitly', async () => {
  detailMock.mockReturnValue(success({ ...client, last_name: null }));
  await renderWithProviders(<EditRoute />);
  await change('Apellido', 'Otro');
  await change('Apellido', '');
  await save();
  assertPatch({ last_name: '' });
});

test('clearing existing optional text preserves empty string instead of null', async () => {
  await renderWithProviders(<EditRoute />);
  await change('Apellido', '');
  await change('Notas', '');
  await save();
  assertPatch({ last_name: '', notes: '' });
});

test('clearing birth date sends null without changing untouched optional values', async () => {
  await renderWithProviders(<EditRoute />);
  await change('Fecha de nacimiento', '');
  await save();
  assertPatch({ birth_date: null });
});

test.each(['2024-02-29', '2099-12-31'])(
  'valid civil date %s is kept as a string without age limits',
  async (date) => {
    await renderWithProviders(<EditRoute />);
    await change('Fecha de nacimiento', date);
    await save();
    assertPatch({ birth_date: date });
  },
);

test('invalid civil date shows schema error and retains draft', async () => {
  await renderWithProviders(<EditRoute />);
  await change('Fecha de nacimiento', '2025-02-29');
  await save();
  expect(
    await screen.findByText('Error: Ingresa una fecha válida en formato YYYY-MM-DD.'),
  ).toBeOnTheScreen();
  expect(input('Fecha de nacimiento')).toHaveProp('value', '2025-02-29');
  expect(mutateCall).not.toHaveBeenCalled();
});

test('archive requires confirmation, can be dismissed and only persists on save', async () => {
  await renderWithProviders(<EditRoute />);
  await press('Archivar cliente');
  expect(screen.getByText('¿Archivar cliente?')).toBeOnTheScreen();
  expect(mutateCall).not.toHaveBeenCalled();
  await press('Seguir editando');
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  await press('Archivar cliente');
  await press('Confirmar archivo');
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  expect(mutateCall).not.toHaveBeenCalled();
  await save();
  assertPatch({ is_active: false });
});

test('archived client can be restored with confirmation and a true-only PATCH', async () => {
  detailMock.mockReturnValue(success({ ...client, is_active: false }));
  await renderWithProviders(<EditRoute />);
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  await press('Restaurar cliente');
  await press('Confirmar restauración');
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  await save();
  assertPatch({ is_active: true });
});

test('confirming archive then restore to the original value leaves no dirty update', async () => {
  await renderWithProviders(<EditRoute />);
  await press('Archivar cliente');
  await press('Confirmar archivo');
  await press('Restaurar cliente');
  await press('Confirmar restauración');
  await save();
  expect(mutateCall).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
});

test('pending disables fields/status/cancel and prevents duplicate submissions before navigating', async () => {
  const request = deferred<ClientRow>();
  mutateCall.mockReturnValue(request.promise);
  await renderWithProviders(<EditRoute />);
  await change(labels[0], 'Nuevo');
  const submit = screen.getByRole('button', { name: 'Guardar cambios' });
  await act(async () => {
    await fireEvent.press(submit);
    await fireEvent.press(submit);
  });
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  labels.forEach((label) => expect(input(label)).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeBusy();
  for (const label of ['Guardar cambios', 'Archivar cliente', 'Cancelar'])
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
  await save();
  await press('Cancelar');
  await press('Archivar cliente');
  expect(mutateCall).toHaveBeenCalledTimes(1);
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(routerMock.back).not.toHaveBeenCalled();
  await act(async () => request.resolve(updated));
  expect(routerMock.replace).toHaveBeenCalledTimes(1);
  expect(routerMock.replace).toHaveBeenCalledWith({
    pathname: '/clients/[id]',
    params: { id: updated.id },
  });
});

test.each(['CLIENT_NOT_FOUND', 'CLIENT_ACCESS_DENIED', 'NETWORK_ERROR', 'UNKNOWN_ERROR'] as const)(
  'mutation %s keeps dirty draft and retries through reset',
  async (code) => {
    mutateCall.mockRejectedValueOnce({
      code,
      message: 'Mensaje seguro',
      details: 'raw SDK hidden',
    });
    await renderWithProviders(<EditRoute />);
    await change('Apellido', '');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje seguro');
    expect(screen.queryByText('raw SDK hidden')).toBeNull();
    expect(input('Apellido')).toHaveProp('value', '');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    expect(routerMock.replace).not.toHaveBeenCalled();
    await save();
    expect(mutateCall).toHaveBeenCalledTimes(2);
    expect(mutateCall).toHaveBeenNthCalledWith(2, {
      clientId: 'client-a',
      input: { last_name: '' },
    });
    expect(resetCall).toHaveBeenCalledTimes(2);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  },
);

test.each([true, false])('cancel with history=%s never persists a dirty draft', async (history) => {
  canGoBackMock.mockReturnValue(history);
  await renderWithProviders(<EditRoute />);
  await change('Notas', 'Sin guardar');
  await press('Cancelar');
  expect(mutateCall).not.toHaveBeenCalled();
  if (history) {
    expect(routerMock.back).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
  } else expect(routerMock.replace).toHaveBeenCalledWith('/clients');
});

test('successful same-identity refetch preserves both dirty draft and its original baseline', async () => {
  const rendered = await renderWithProviders(<EditRoute />);
  await change('Notas', 'Borrador local');
  detailMock.mockReturnValue(
    success({ ...client, first_name: 'Nombre remoto', notes: 'Nota remota' }, true),
  );
  await rendered.rerender(<EditRoute />);
  expect(input(labels[0])).toHaveProp('value', 'Martín');
  expect(input('Notas')).toHaveProp('value', 'Borrador local');
  await save();
  assertPatch({ notes: 'Borrador local' });
});

test.each(['route', 'business'] as const)(
  '%s transition initializes a fresh draft without old dirty fields',
  async (transition) => {
    const rendered = await renderWithProviders(<ClientEditScreen clientId="client-a" />);
    await change('Notas', 'Borrador A');
    if (transition === 'business') businessMock.mockReturnValue(business('business-b'));
    detailMock.mockReturnValue(pending);
    const nextId = transition === 'route' ? 'client-b' : 'client-a';
    await rendered.rerender(<ClientEditScreen clientId={nextId} />);
    expect(screen.queryByLabelText('Notas')).toBeNull();
    detailMock.mockReturnValue(
      success({ ...client, id: nextId, first_name: 'Cliente B', notes: 'Nota B' }),
    );
    await rendered.rerender(<ClientEditScreen clientId={nextId} />);
    expect(input(labels[0])).toHaveProp('value', 'Cliente B');
    expect(input('Notas')).toHaveProp('value', 'Nota B');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await change('Notas', 'Nuevo B');
    await save();
    assertPatch({ notes: 'Nuevo B' }, nextId);
  },
);

test('loss of business context removes the old form', async () => {
  const rendered = await renderWithProviders(<EditRoute />);
  await change('Notas', 'Borrador A');
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  detailMock.mockReturnValue(idle);
  await rendered.rerender(<EditRoute />);
  expect(screen.queryByLabelText('Notas')).toBeNull();
  expect(screen.getByRole('status', { name: 'Cliente no disponible' })).toBeOnTheScreen();
});

test.each(['route', 'business', 'unmount'] as const)(
  'late success after %s transition cannot navigate or reset the next draft',
  async (transition) => {
    const request = deferred<ClientRow>();
    mutateCall.mockReturnValue(request.promise);
    const rendered = await renderWithProviders(<ClientEditScreen clientId="client-a" />);
    await change('Notas', 'Pendiente A');
    await save();
    if (transition === 'unmount') await rendered.unmount();
    else {
      if (transition === 'business') businessMock.mockReturnValue(business('business-b'));
      detailMock.mockReturnValue(success({ ...client, id: 'client-b', notes: 'Nota B' }));
      await rendered.rerender(
        <ClientEditScreen clientId={transition === 'route' ? 'client-b' : 'client-a'} />,
      );
      await change('Notas', 'Borrador B');
    }
    await act(async () => request.resolve(updated));
    expect(routerMock.replace).not.toHaveBeenCalled();
    if (transition !== 'unmount') expect(input('Notas')).toHaveProp('value', 'Borrador B');
  },
);

test('late failure from client A does not show an error or overwrite client B', async () => {
  const request = deferred<ClientRow>();
  mutateCall.mockReturnValue(request.promise);
  const rendered = await renderWithProviders(<ClientEditScreen clientId="client-a" />);
  await change('Notas', 'Pendiente A');
  await save();
  detailMock.mockReturnValue(success({ ...client, id: 'client-b', notes: 'Nota B' }));
  await rendered.rerender(<ClientEditScreen clientId="client-b" />);
  await change('Notas', 'Borrador B');
  await act(async () => request.reject({ code: 'NETWORK_ERROR', message: 'Error de A' }));
  expect(input('Notas')).toHaveProp('value', 'Borrador B');
  expect(screen.queryByText('Error de A')).toBeNull();
  expect(routerMock.replace).not.toHaveBeenCalled();
});
