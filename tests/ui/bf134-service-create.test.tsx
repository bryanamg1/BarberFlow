import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useState } from 'react';

import CreateRoute from '@/app/(app)/services/new';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { ServiceForm } from '@/features/services/components/ServiceForm';
import { useCreateService } from '@/features/services/hooks/useCreateService';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import type { CreateServiceInput } from '@/features/services/schemas/service.schema';
import { ServiceCreateScreen } from '@/features/services/screens/ServiceCreateScreen';
import type { ServiceError } from '@/features/services/types/service.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/hooks/useCreateService', () => ({ useCreateService: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
jest.mock('expo-router', () => {
  const { routerMock } =
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils');
  return { router: { ...routerMock, canGoBack: jest.fn() } };
});

const businessMock = jest.mocked(useBusiness);
const hookMock = jest.mocked(useCreateService);
const canGoBackMock = jest.mocked(router.canGoBack);
const mutateCall = jest.fn<Promise<ServiceRow>, [CreateServiceInput]>();
const resetCall = jest.fn();
const created: ServiceRow = {
  id: 'persisted-service-id',
  business_id: 'business-a',
  name: 'Corte',
  description: null,
  price: 1.01,
  duration_minutes: 30,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
function business(
  id = 'business-a',
  role: 'OWNER' | 'BARBER' = 'OWNER',
  currency = 'ARS',
): BusinessContextValue {
  return {
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId: 'membership',
      role,
      business: {
        id,
        name: 'Business',
        currency_code: currency,
        timezone: 'America/Argentina/Buenos_Aires',
        is_active: true,
      },
    },
  };
}
type MutationState =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ServiceRow; error: null }
  | { status: 'error'; data: null; error: ServiceError };
function useTestMutation(): ReturnType<typeof useCreateService> {
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
        setState({ status: 'error', data: null, error: error as ServiceError });
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
const labels = {
  name: 'Nombre (obligatorio)',
  description: 'Descripción',
  price: 'Precio (obligatorio)',
  duration: 'Duración en minutos (obligatorio)',
};
const input = (label: string) => screen.getByLabelText(label);
const change = (label: string, value: string) => fireEvent.changeText(input(label), value);
const press = (label: string) => userEvent.press(screen.getByRole('button', { name: label }));
const submit = () => press('Crear servicio');
async function fill() {
  await change(labels.name, '  Corte  ');
  await change(labels.price, '1.01');
  await change(labels.duration, '30');
}

beforeEach(() => {
  resetRouterMocks();
  resetCall.mockReset();
  mutateCall.mockReset().mockResolvedValue(created);
  businessMock.mockReturnValue(business());
  hookMock.mockImplementation(useTestMutation);
  canGoBackMock.mockReturnValue(true);
});

test('thin new route mounts four labeled empty fields and create/cancel only', async () => {
  await renderWithProviders(<CreateRoute />);
  expect(screen.getByRole('heading', { name: 'Crear servicio' })).toBeOnTheScreen();
  for (const label of Object.values(labels)) expect(input(label)).toHaveProp('value', '');
  expect(input(labels.description)).toHaveProp('multiline', true);
  expect(input(labels.price)).toHaveProp('keyboardType', 'decimal-pad');
  expect(input(labels.duration)).toHaveProp('keyboardType', 'number-pad');
  expect(screen.getByRole('button', { name: 'Crear servicio' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  expect(
    screen.queryByLabelText(/is_active|business_id|created_at|updated_at|Activo|ID/),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Archivar|Restaurar|Eliminar|Guardar cambios/ }),
  ).toBeNull();
});
test('blank submit rejects all required fields, never treating blank price as zero', async () => {
  await renderWithProviders(<CreateRoute />);
  await submit();
  expect(await screen.findByText('Error: Ingresa el nombre del servicio.')).toBeOnTheScreen();
  expect(
    screen.getByText('Error: Ingresa un precio con hasta dos decimales usando punto.'),
  ).toBeOnTheScreen();
  expect(screen.getByText('Error: Ingresa una duración en minutos enteros.')).toBeOnTheScreen();
  expect(mutateCall).not.toHaveBeenCalled();
});
test('space-only name rejected by domain; correcting values permits create', async () => {
  await renderWithProviders(<CreateRoute />);
  await fill();
  await change(labels.name, '   ');
  await submit();
  expect(await screen.findByText('Error: Ingresa el nombre del servicio.')).toBeOnTheScreen();
  expect(mutateCall).not.toHaveBeenCalled();
  await change(labels.name, '  Corte  ');
  await submit();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({
      name: '  Corte  ',
      price: 1.01,
      duration_minutes: 30,
    }),
  );
});
test.each([
  ['0', 0],
  ['0.00', 0],
  ['0.29', 0.29],
  ['1.01', 1.01],
  ['12.50', 12.5],
  ['9999999999.99', 9999999999.99],
])('price %s reaches mutation as exact number', async (text, number) => {
  await renderWithProviders(<CreateRoute />);
  await fill();
  await change(labels.price, String(text));
  await submit();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({
      name: '  Corte  ',
      price: number,
      duration_minutes: 30,
    }),
  );
});
test.each(['', '1.001', '-1', 'text', '10000000000', '1,01'])(
  'invalid price %j never mutates or rounds',
  async (value) => {
    await renderWithProviders(<CreateRoute />);
    await fill();
    await change(labels.price, value);
    await submit();
    expect(await screen.findByText(/^Error: (Ingresa un precio|El precio)/)).toBeOnTheScreen();
    expect(mutateCall).not.toHaveBeenCalled();
    expect(input(labels.price)).toHaveProp('value', value);
  },
);
test.each([
  ['1', 1],
  ['17', 17],
  ['2147483647', 2147483647],
])('duration %s has no invented step rule', async (text, number) => {
  await renderWithProviders(<CreateRoute />);
  await fill();
  await change(labels.duration, String(text));
  await submit();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({
      name: '  Corte  ',
      price: 1.01,
      duration_minutes: number,
    }),
  );
});
test.each(['', '0', '-1', '1.5', 'text', '2147483648'])(
  'invalid duration %j never mutates',
  async (value) => {
    await renderWithProviders(<CreateRoute />);
    await fill();
    await change(labels.duration, value);
    await submit();
    expect(await screen.findByText(/^Error: (Ingresa una duración|La duración)/)).toBeOnTheScreen();
    expect(mutateCall).not.toHaveBeenCalled();
  },
);
test.each(['  descripción\noriginal  ', ''])(
  'edited description %j preserved exactly, untouched omitted elsewhere',
  async (description) => {
    await renderWithProviders(<CreateRoute />);
    await fill();
    await change(labels.description, 'edited');
    await change(labels.description, description);
    await submit();
    await waitFor(() =>
      expect(mutateCall).toHaveBeenCalledWith({
        name: '  Corte  ',
        price: 1.01,
        duration_minutes: 30,
        description,
      }),
    );
  },
);
test('pending is accessible, disables fields/cancel/submit and blocks duplicate writes', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  await renderWithProviders(<CreateRoute />);
  await fill();
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Creando servicio…')).toHaveProp('role', 'status');
  expect(screen.getByRole('button', { name: 'Crear servicio' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Crear servicio' })).toBeBusy();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  for (const label of Object.values(labels)) expect(input(label)).toBeDisabled();
  await submit();
  await press('Cancelar');
  expect(mutateCall).toHaveBeenCalledTimes(1);
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(routerMock.back).not.toHaveBeenCalled();
  await act(async () => operation.resolve({ ...created, id: 'different-persisted-id' }));
  await waitFor(() =>
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/services/[id]/edit',
      params: { id: 'different-persisted-id' },
    }),
  );
  expect(routerMock.push).not.toHaveBeenCalled();
});
test('two immediate submit events are guarded before async validation completes', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  await renderWithProviders(<CreateRoute />);
  await fill();
  const onPress = input(labels.duration).props.onSubmitEditing;
  await act(async () => {
    onPress();
    onPress();
  });
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  await act(async () => operation.resolve(created));
});
test('successful shared form returns the full persisted row and prevents resubmit', async () => {
  const onSuccess = jest.fn();
  await renderWithProviders(
    <ServiceForm currency="USD" onSuccess={onSuccess} onCancel={jest.fn()} />,
  );
  await fill();
  await submit();
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(created));
  expect(screen.getByRole('button', { name: 'Crear servicio' })).toBeDisabled();
  expect(screen.getByText(/USD · Usa punto/)).toBeOnTheScreen();
  expect(mutateCall.mock.calls[0][0]).toEqual({
    name: '  Corte  ',
    price: 1.01,
    duration_minutes: 30,
  });
});
test.each(['SERVICE_ACCESS_DENIED', 'NETWORK_ERROR', 'UNKNOWN_ERROR'] as const)(
  '%s shows only safe message, preserves values and allows retry',
  async (code) => {
    mutateCall.mockRejectedValueOnce({
      code,
      message: 'No se pudo crear el servicio.',
      details: 'private SQL',
      stack: 'private SDK',
    });
    await renderWithProviders(<CreateRoute />);
    await fill();
    await change(labels.description, 'borrador');
    await submit();
    expect(
      await screen.findByRole('alert', { name: 'No se pudo crear el servicio.' }),
    ).toBeOnTheScreen();
    expect(input(labels.name)).toHaveProp('value', '  Corte  ');
    expect(input(labels.description)).toHaveProp('value', 'borrador');
    expect(input(labels.price)).toHaveProp('value', '1.01');
    expect(input(labels.duration)).toHaveProp('value', '30');
    expect(screen.queryByText(/private SQL|private SDK/)).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
    await submit();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    expect(mutateCall).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(resetCall).toHaveBeenCalledTimes(2);
  },
);
test('editing a failed draft resets hook error without copying it locally', async () => {
  mutateCall.mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Error seguro' });
  await renderWithProviders(<CreateRoute />);
  await fill();
  await submit();
  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  await change(labels.name, 'Corregido');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(input(labels.price)).toHaveProp('value', '1.01');
});
test.each([true, false])(
  'cancel canGoBack=%s has no mutation and uses safe fallback',
  async (canGoBack) => {
    canGoBackMock.mockReturnValue(canGoBack);
    await renderWithProviders(<CreateRoute />);
    await fill();
    await press('Cancelar');
    expect(mutateCall).not.toHaveBeenCalled();
    if (canGoBack) {
      expect(routerMock.back).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).not.toHaveBeenCalled();
    } else {
      expect(routerMock.replace).toHaveBeenCalledWith('/services');
      expect(routerMock.back).not.toHaveBeenCalled();
    }
  },
);
test('BARBER manual URL cannot mount create hook or submit', async () => {
  businessMock.mockReturnValue(business('business-a', 'BARBER'));
  await renderWithProviders(<CreateRoute />);
  expect(screen.getByRole('status', { name: /Acceso restringido/ })).toBeOnTheScreen();
  expect(screen.queryByLabelText(labels.name)).toBeNull();
  expect(hookMock).not.toHaveBeenCalled();
  expect(mutateCall).not.toHaveBeenCalled();
});
test.each(['idle', 'pending', 'error'] as const)(
  'business %s gates form and mutation',
  async (status) => {
    businessMock.mockReturnValue(
      status === 'error'
        ? {
            status,
            data: null,
            isFetching: false,
            error: { code: 'NO_ACTIVE_MEMBERSHIP', message: 'Negocio no disponible.' },
          }
        : ({
            status,
            data: null,
            error: null,
            isFetching: status === 'pending',
          } as BusinessContextValue),
    );
    await renderWithProviders(<CreateRoute />);
    expect(hookMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(labels.name)).toBeNull();
    if (status === 'pending')
      expect(screen.getByRole('progressbar', { name: 'Cargando negocio…' })).toBeOnTheScreen();
    if (status === 'error')
      expect(screen.getByRole('alert', { name: /Negocio no disponible/ })).toBeOnTheScreen();
  },
);
test.each(['resolve', 'reject'] as const)(
  'late %s after tenant switch cannot navigate or change new draft',
  async (outcome) => {
    const operation = deferred<ServiceRow>();
    mutateCall.mockReturnValue(operation.promise);
    const rendered = await renderWithProviders(<CreateRoute />);
    await fill();
    await submit();
    await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
    businessMock.mockReturnValue(business('business-b'));
    await rendered.rerender(<CreateRoute />);
    expect(input(labels.name)).toHaveProp('value', '');
    await change(labels.name, 'Business B');
    await act(async () => {
      if (outcome === 'resolve') operation.resolve(created);
      else operation.reject({ code: 'NETWORK_ERROR', message: 'Error A' });
    });
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(input(labels.name)).toHaveProp('value', 'Business B');
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
test('role downgrade unmounts pending form and suppresses late navigation', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<CreateRoute />);
  await fill();
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  businessMock.mockReturnValue(business('business-a', 'BARBER'));
  await rendered.rerender(<CreateRoute />);
  await act(async () => operation.resolve(created));
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(labels.name)).toBeNull();
});
test('unmount during create prevents late success navigation', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<CreateRoute />);
  await fill();
  await submit();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  await rendered.unmount();
  await act(async () => operation.resolve(created));
  expect(routerMock.replace).not.toHaveBeenCalled();
});
