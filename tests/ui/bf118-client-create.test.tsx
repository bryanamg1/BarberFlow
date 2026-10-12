import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useState } from 'react';

import CreateRoute from '@/app/(app)/clients/new';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { ClientForm } from '@/features/clients/components/ClientForm';
import { useCreateClient } from '@/features/clients/hooks/useCreateClient';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import type { CreateClientInput } from '@/features/clients/schemas/client.schema';
import { ClientCreateScreen } from '@/features/clients/screens/ClientCreateScreen';
import type { ClientServiceError } from '@/features/clients/types/client.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/clients/hooks/useCreateClient', () => ({ useCreateClient: jest.fn() }));
// ClientForm supports edit too; keep that unused server boundary isolated from provider setup.
jest.mock('@/features/clients/hooks/useUpdateClient', () => ({ useUpdateClient: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
// Extend only this screen's Router boundary; shared push/replace/back spies stay unchanged.
jest.mock('expo-router', () => {
  const { routerMock } =
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils');
  return { router: { ...routerMock, canGoBack: jest.fn() } };
});

const businessMock = jest.mocked(useBusiness);
const mutationMock = jest.mocked(useCreateClient);
const canGoBackMock = jest.mocked(router.canGoBack);
const mutateCall = jest.fn<Promise<ClientRow>, [CreateClientInput]>();
const resetCall = jest.fn();
const created: ClientRow = {
  id: 'returned-client-id',
  business_id: 'business-a',
  first_name: 'Martín',
  last_name: null,
  phone: null,
  email: null,
  instagram: null,
  birth_date: null,
  notes: null,
  preferences: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
function business(id = 'business-a'): BusinessContextValue {
  return {
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
  };
}
type MutationState =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ClientRow; error: null }
  | { status: 'error'; data: null; error: ClientServiceError };
function useTestMutation(): ReturnType<typeof useCreateClient> {
  const [state, setState] = useState<MutationState>({ status: 'idle', data: null, error: null });
  return {
    ...state,
    reset: () => {
      resetCall();
      setState({ status: 'idle', data: null, error: null });
    },
    mutateAsync: async (input) => {
      setState({ status: 'pending', data: null, error: null });
      try {
        const data = await mutateCall(input);
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
const submit = () => press('Crear cliente');
const fillName = (value = 'Martín') => change('Nombre (obligatorio)', value);

beforeEach(() => {
  resetRouterMocks();
  mutateCall.mockReset().mockResolvedValue(created);
  resetCall.mockReset();
  canGoBackMock.mockReturnValue(true);
  businessMock.mockReturnValue(business());
  mutationMock.mockImplementation(useTestMutation);
});

test('new route renders exactly eight labeled fields, required name and both actions', async () => {
  await renderWithProviders(<CreateRoute />);
  expect(screen.getByRole('heading', { name: 'Nuevo cliente' })).toBeOnTheScreen();
  for (const label of [
    'Nombre (obligatorio)',
    'Apellido',
    'Teléfono',
    'Email',
    'Instagram',
    'Fecha de nacimiento',
    'Notas',
    'Preferencias',
  ]) {
    expect(input(label)).toBeOnTheScreen();
    expect(input(label)).toHaveProp('value', '');
  }
  expect(
    screen.getAllByLabelText(
      /^(Nombre \(obligatorio\)|Apellido|Teléfono|Email|Instagram|Fecha de nacimiento|Notas|Preferencias)$/,
    ),
  ).toHaveLength(8);
  expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  expect(screen.getByText('YYYY-MM-DD (opcional)')).toBeOnTheScreen();
  expect(input('Notas')).toHaveProp('multiline', true);
  expect(input('Preferencias')).toHaveProp('multiline', true);
  expect(screen.queryByLabelText('Activo')).toBeNull();
});

test.each(['', '   '])(
  'invalid name %j shows the schema error without mutation or navigation',
  async (name) => {
    await renderWithProviders(<ClientCreateScreen />);
    await fillName(name);
    await submit();
    expect(await screen.findByText('Error: Ingresa el nombre.')).toBeOnTheScreen();
    expect(input('Nombre (obligatorio)')).toHaveProp(
      'accessibilityHint',
      'Error: Ingresa el nombre.',
    );
    expect(mutateCall).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);

test('valid name preserves original spacing and omits all untouched optional/managed fields', async () => {
  await renderWithProviders(<ClientCreateScreen />);
  await fillName('  María del Mar  ');
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  expect(mutateCall).toHaveBeenCalledWith({ first_name: '  María del Mar  ' });
});

test('explicitly edited empty optional text stays empty rather than null or omitted', async () => {
  await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  for (const label of ['Apellido', 'Teléfono', 'Email', 'Instagram', 'Notas', 'Preferencias']) {
    await change(label, 'temporary');
    await change(label, '');
  }
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  expect(mutateCall).toHaveBeenCalledWith({
    first_name: 'Martín',
    last_name: '',
    phone: '',
    email: '',
    instagram: '',
    notes: '',
    preferences: '',
  });
});

test('optional free text is not trimmed, lowercased or subjected to email/phone/Instagram formats', async () => {
  await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await change('Apellido', '  Pérez  ');
  await change('Teléfono', 'Llamar al interno X');
  await change('Email', '  NO ES EMAIL  ');
  await change('Instagram', 'Un texto libre');
  await change('Notas', 'Primera línea\nSegunda línea');
  await change('Preferencias', '  Sin perfume  ');
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  expect(mutateCall).toHaveBeenCalledWith({
    first_name: 'Martín',
    last_name: '  Pérez  ',
    phone: 'Llamar al interno X',
    email: '  NO ES EMAIL  ',
    instagram: 'Un texto libre',
    notes: 'Primera línea\nSegunda línea',
    preferences: '  Sin perfume  ',
  });
});

test.each(['2025-02-29', '31/12/2000'])(
  'invalid civil date %s is rejected through the schema',
  async (date) => {
    await renderWithProviders(<ClientCreateScreen />);
    await fillName();
    await change('Fecha de nacimiento', date);
    await submit();
    expect(
      await screen.findByText('Error: Ingresa una fecha válida en formato YYYY-MM-DD.'),
    ).toBeOnTheScreen();
    expect(mutateCall).not.toHaveBeenCalled();
  },
);

test.each(['2000-02-29', '2099-12-31'])(
  'valid civil date %s passes unchanged without age restrictions',
  async (date) => {
    await renderWithProviders(<ClientCreateScreen />);
    await fillName();
    await change('Fecha de nacimiento', date);
    await submit();
    await waitFor(() =>
      expect(mutateCall).toHaveBeenCalledWith({ first_name: 'Martín', birth_date: date }),
    );
  },
);

test('clearing the date maps to null before schema validation', async () => {
  await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await change('Fecha de nacimiento', '2000-02-29');
  await change('Fecha de nacimiento', '');
  await submit();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({ first_name: 'Martín', birth_date: null }),
  );
});

test('schema failure can be corrected and submitted successfully', async () => {
  await renderWithProviders(<ClientCreateScreen />);
  await submit();
  expect(await screen.findByText('Error: Ingresa el nombre.')).toBeOnTheScreen();
  await fillName();
  await submit();
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Error: Ingresa el nombre.')).toBeNull();
});

test('pending disables inputs, submit and cancel; repeated presses cannot duplicate the write', async () => {
  const operation = deferred<ClientRow>();
  mutateCall.mockReturnValue(operation.promise);
  await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  const save = screen.getByRole('button', { name: 'Crear cliente' });
  expect(save).toBeDisabled();
  expect(save).toBeBusy();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(input('Nombre (obligatorio)')).toBeDisabled();
  await submit();
  await press('Cancelar');
  expect(mutateCall).toHaveBeenCalledTimes(1);
  expect(routerMock.back).not.toHaveBeenCalled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  await act(async () => operation.resolve(created));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/clients/[id]',
      params: { id: created.id },
    }),
  );
});

test('success uses returned id with replace only after resolution; inactive result is not altered', async () => {
  const operation = deferred<ClientRow>();
  mutateCall.mockReturnValue(operation.promise);
  const onSuccess = jest.fn();
  await renderWithProviders(
    <ClientForm mode="create" onSuccess={onSuccess} onCancel={jest.fn()} />,
  );
  await fillName();
  await submit();
  expect(onSuccess).not.toHaveBeenCalled();
  const returned = { ...created, id: 'another-returned-id', is_active: false };
  await act(async () => operation.resolve(returned));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(returned));
  expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeDisabled();
});

test('screen navigates to exact returned detail, not back to the submitted form', async () => {
  mutateCall.mockResolvedValue({ ...created, id: 'server-generated-id' });
  await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await submit();
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/clients/[id]',
      params: { id: 'server-generated-id' },
    }),
  );
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(routerMock.back).not.toHaveBeenCalled();
});

test.each([true, false])(
  'cancel with canGoBack=%s returns safely without mutation',
  async (canGoBack) => {
    canGoBackMock.mockReturnValue(canGoBack);
    await renderWithProviders(<ClientCreateScreen />);
    await fillName('Unsaved client');
    await press('Cancelar');
    expect(mutateCall).not.toHaveBeenCalled();
    if (canGoBack) {
      expect(routerMock.back).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).not.toHaveBeenCalled();
    } else {
      expect(routerMock.replace).toHaveBeenCalledWith('/clients');
      expect(routerMock.back).not.toHaveBeenCalled();
    }
  },
);

test.each(['CLIENT_ACCESS_DENIED', 'NETWORK_ERROR', 'UNKNOWN_ERROR'] as const)(
  '%s displays safe domain error, preserves draft and never navigates',
  async (code) => {
    const safe = { code, message: `Mensaje seguro ${code}` };
    mutateCall.mockRejectedValue(
      Object.assign(safe, { details: 'raw SQL secret', stack: 'SDK stack secret' }),
    );
    await renderWithProviders(<ClientCreateScreen />);
    await fillName('Nombre conservado');
    await change('Notas', 'Notas conservadas');
    await submit();
    expect(await screen.findByRole('alert', { name: safe.message })).toBeOnTheScreen();
    expect(input('Nombre (obligatorio)')).toHaveProp('value', 'Nombre conservado');
    expect(input('Notas')).toHaveProp('value', 'Notas conservadas');
    expect(screen.queryByText(/raw SQL|SDK stack/)).toBeNull();
    expect(screen.queryByText('Error: Ingresa el nombre.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);

test('new attempt resets the old server error and succeeds with the preserved draft', async () => {
  mutateCall.mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Error seguro inicial' });
  const retry = deferred<ClientRow>();
  mutateCall.mockReturnValueOnce(retry.promise);
  await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await submit();
  expect(await screen.findByRole('alert', { name: 'Error seguro inicial' })).toBeOnTheScreen();
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(resetCall).toHaveBeenCalledTimes(2);
  await act(async () => retry.resolve(created));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
});

test.each(['idle', 'pending', 'error'] as const)(
  'business %s gates the form/mutation',
  async (status) => {
    businessMock.mockReturnValue(
      status === 'error'
        ? {
            status,
            data: null,
            isFetching: false,
            error: { code: 'NO_ACTIVE_MEMBERSHIP', message: 'No hay un negocio disponible.' },
          }
        : status === 'idle'
          ? { status, data: null, error: null, isFetching: false }
          : { status, data: null, error: null, isFetching: true },
    );
    await renderWithProviders(<ClientCreateScreen />);
    expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
    expect(mutationMock).not.toHaveBeenCalled();
    if (status === 'pending')
      expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
    if (status === 'error')
      expect(screen.getByRole('alert', { name: /No hay un negocio disponible/ })).toBeOnTheScreen();
    if (status === 'idle')
      expect(screen.getByRole('status', { name: /Negocio no disponible/ })).toBeOnTheScreen();
  },
);

test('unmount before resolution prevents late navigation', async () => {
  const operation = deferred<ClientRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await submit();
  await rendered.unmount();
  await act(async () => operation.resolve(created));
  expect(routerMock.replace).not.toHaveBeenCalled();
});

test.each(['success', 'failure'] as const)(
  'late A %s cannot navigate or reset the B draft',
  async (outcome) => {
    const operation = deferred<ClientRow>();
    mutateCall.mockReturnValue(operation.promise);
    const rendered = await renderWithProviders(<ClientCreateScreen />);
    await fillName('Negocio A');
    await submit();
    businessMock.mockReturnValue(business('business-b'));
    await rendered.rerender(<ClientCreateScreen />);
    expect(input('Nombre (obligatorio)')).toHaveProp('value', '');
    await fillName('Negocio B');
    await act(async () => {
      if (outcome === 'success') operation.resolve(created);
      else operation.reject({ code: 'NETWORK_ERROR', message: 'Error de A' });
    });
    expect(input('Nombre (obligatorio)')).toHaveProp('value', 'Negocio B');
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  },
);

test('business becoming unavailable removes the draft and blocks late completion', async () => {
  const operation = deferred<ClientRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<ClientCreateScreen />);
  await fillName();
  await submit();
  businessMock.mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  await rendered.rerender(<ClientCreateScreen />);
  await act(async () => operation.resolve(created));
  expect(screen.queryByLabelText('Nombre (obligatorio)')).toBeNull();
  expect(routerMock.replace).not.toHaveBeenCalled();
});
