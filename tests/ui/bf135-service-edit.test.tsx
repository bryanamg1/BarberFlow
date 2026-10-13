import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import EditRoute from '@/app/(app)/services/[id]/edit';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import {
  useServiceDetail,
  type UseServiceDetailResult,
} from '@/features/services/hooks/useServiceDetail';
import { useUpdateService } from '@/features/services/hooks/useUpdateService';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { ServiceEditScreen } from '@/features/services/screens/ServiceEditScreen';
import type { ServiceError } from '@/features/services/types/service.types';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/services/hooks/useServiceDetail', () => ({ useServiceDetail: jest.fn() }));
jest.mock('@/features/services/hooks/useUpdateService', () => ({ useUpdateService: jest.fn() }));
jest.mock('@/features/services/hooks/useCreateService', () => ({ useCreateService: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 64 }));
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
const detailMock = jest.mocked(useServiceDetail);
const mutationMock = jest.mocked(useUpdateService);
const paramsMock = jest.mocked(useLocalSearchParams);
const backMock = jest.mocked(router.canGoBack);
type Variables = Parameters<ReturnType<typeof useUpdateService>['mutateAsync']>[0];
const mutateCall = jest.fn<Promise<ServiceRow>, [Variables]>();
const resetCall = jest.fn();
const business = (id = 'business-a', role: 'OWNER' | 'BARBER' = 'OWNER'): BusinessContextValue => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'membership',
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
const service: ServiceRow = {
  id: 'service-a',
  business_id: 'business-a',
  name: '  Corte  ',
  description: null,
  price: 0.29,
  duration_minutes: 30,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const success = (data = service, isFetching = false): UseServiceDetailResult => ({
  status: 'success',
  data,
  error: null,
  isFetching,
});
type MutationState =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ServiceRow; error: null }
  | { status: 'error'; data: null; error: ServiceError };
function useTestMutation(): ReturnType<typeof useUpdateService> {
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
const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));
const save = () => press('Guardar cambios');
const noNavigation = () => {
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  expect(routerMock.back).not.toHaveBeenCalled();
};
beforeEach(() => {
  resetRouterMocks();
  resetCall.mockReset();
  backMock.mockReturnValue(true);
  paramsMock.mockReturnValue({ id: service.id });
  businessMock.mockReturnValue(business());
  detailMock.mockReturnValue(success());
  mutationMock.mockImplementation(useTestMutation);
  mutateCall.mockReset().mockImplementation(async ({ input }) => ({ ...service, ...input }));
});

test('thin route loads original scalar ID and exact values; clean save does not mutate', async () => {
  paramsMock.mockReturnValue({ id: ' service-a ' });
  await renderWithProviders(<EditRoute />);
  expect(detailMock).toHaveBeenCalledWith(' service-a ');
  expect(screen.getByRole('heading', { name: 'Editar servicio' })).toBeOnTheScreen();
  for (const [key, value] of [
    ['name', service.name],
    ['description', ''],
    ['price', '0.29'],
    ['duration', '30'],
  ] as const)
    expect(input(labels[key])).toHaveProp('value', value);
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  await save();
  expect(mutateCall).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/business_id|is_active|created_at|updated_at|ID/)).toBeNull();
});
test.each([undefined, '', '  ', ['a'], ['a', 'b']])(
  'invalid route id %j never mounts management or queries',
  async (id) => {
    paramsMock.mockReturnValue({ id } as ReturnType<typeof useLocalSearchParams>);
    await renderWithProviders(<EditRoute />);
    expect(screen.getByText('Servicio no disponible')).toBeOnTheScreen();
    expect(detailMock).not.toHaveBeenCalled();
    expect(mutationMock).not.toHaveBeenCalled();
  },
);
test('BARBER direct URL cannot mount detail/update or management', async () => {
  businessMock.mockReturnValue(business('business-a', 'BARBER'));
  await renderWithProviders(<EditRoute />);
  expect(screen.getByText('Acceso restringido')).toBeOnTheScreen();
  expect(detailMock).not.toHaveBeenCalled();
  expect(mutationMock).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(labels.name)).toBeNull();
});
test.each(['idle', 'pending', 'error'] as const)(
  'business %s safely gates editing',
  async (status) => {
    businessMock.mockReturnValue(
      status === 'error'
        ? {
            status,
            data: null,
            error: { code: 'UNKNOWN_ERROR', message: 'Negocio no disponible' },
            isFetching: false,
          }
        : ({
            status,
            data: null,
            error: null,
            isFetching: status === 'pending',
          } as BusinessContextValue),
    );
    await renderWithProviders(<EditRoute />);
    expect(detailMock).not.toHaveBeenCalled();
    expect(mutationMock).not.toHaveBeenCalled();
  },
);
test('initial pending has accessible loading and no empty editable form', async () => {
  detailMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
  const rendered = await renderWithProviders(<EditRoute />);
  expect(screen.getByRole('progressbar', { name: 'Cargando servicio…' })).toBeOnTheScreen();
  expect(screen.queryByLabelText(labels.name)).toBeNull();
  detailMock.mockReturnValue(
    success({
      ...service,
      description: '  Texto\noriginal  ',
      price: 10000.5,
      duration_minutes: 17,
    }),
  );
  await rendered.rerender(<EditRoute />);
  expect(input(labels.description)).toHaveProp('value', '  Texto\noriginal  ');
  expect(input(labels.price)).toHaveProp('value', '10000.5');
  expect(input(labels.duration)).toHaveProp('value', '17');
});
test.each([
  'SERVICE_NOT_FOUND',
  'SERVICE_ACCESS_DENIED',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
] as const)(
  'detail %s exposes safe error, no form and exact-key retry where applicable',
  async (code) => {
    detailMock.mockReturnValue({
      status: 'error',
      data: null,
      error: { code, message: 'Mensaje seguro' },
      isFetching: false,
    });
    const rendered = await renderWithProviders(<EditRoute />);
    const invalidate = jest.spyOn(rendered.queryClient, 'invalidateQueries');
    expect(screen.getByText('Mensaje seguro')).toBeOnTheScreen();
    expect(mutationMock).not.toHaveBeenCalled();
    if (code === 'SERVICE_NOT_FOUND')
      expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    else {
      await press('Reintentar');
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: servicesKeys.detail('business-a', service.id),
        exact: true,
      });
    }
  },
);
test.each([
  ['name', '  Nuevo nombre  ', { name: '  Nuevo nombre  ' }],
  ['description', '  Texto\noriginal  ', { description: '  Texto\noriginal  ' }],
  ['price', '1.01', { price: 1.01 }],
  ['price', '0', { price: 0 }],
  ['duration', '17', { duration_minutes: 17 }],
] as const)('only dirty %s becomes a minimal domain patch', async (field, value, patch) => {
  await renderWithProviders(<EditRoute />);
  await change(labels[field], value);
  await save();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({ serviceId: service.id, input: patch }),
  );
  expect(mutateCall).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled(),
  );
  noNavigation();
});
test('clearing existing description sends empty string, untouched null and other fields omitted', async () => {
  detailMock.mockReturnValue(success({ ...service, description: 'Texto' }));
  await renderWithProviders(<EditRoute />);
  await change(labels.description, '');
  await save();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({ serviceId: service.id, input: { description: '' } }),
  );
});
test('multi-field patch excludes tenant/audit/is_active and resets to returned persisted values', async () => {
  mutateCall.mockResolvedValue({
    ...service,
    name: 'Persistido',
    price: 12.5,
    duration_minutes: 45,
    description: 'Servidor',
  });
  await renderWithProviders(<EditRoute />);
  await change(labels.name, 'Nuevo');
  await change(labels.price, '12.50');
  await change(labels.duration, '45');
  await save();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({
      serviceId: service.id,
      input: { name: 'Nuevo', price: 12.5, duration_minutes: 45 },
    }),
  );
  await waitFor(() => expect(input(labels.name)).toHaveProp('value', 'Persistido'));
  expect(input(labels.price)).toHaveProp('value', '12.5');
  expect(input(labels.description)).toHaveProp('value', 'Servidor');
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  await change(labels.name, 'Otro');
  await save();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(2));
  noNavigation();
});
test('reverting a field to the default does not send an empty patch', async () => {
  await renderWithProviders(<EditRoute />);
  await change(labels.name, 'Nuevo');
  await change(labels.name, service.name);
  await save();
  expect(mutateCall).not.toHaveBeenCalled();
});
test.each([
  ['name', '   '],
  ['price', ''],
  ['price', '-1'],
  ['price', '1.001'],
  ['price', '1,01'],
  ['price', '10000000000'],
  ['price', '1x'],
  ['duration', ''],
  ['duration', '0'],
  ['duration', '-1'],
  ['duration', '1.5'],
  ['duration', '2147483648'],
  ['duration', '30min'],
] as const)('invalid %s %j is associated and blocks update', async (field, value) => {
  await renderWithProviders(<EditRoute />);
  await change(labels[field], value);
  await save();
  await waitFor(() => expect(input(labels[field]).props.accessibilityHint).toMatch(/^Error:/));
  expect(mutateCall).not.toHaveBeenCalled();
});
test('same-service refetch preserves dirty fields and shows fetched active state', async () => {
  const rendered = await renderWithProviders(<EditRoute />);
  await change(labels.name, 'Borrador');
  detailMock.mockReturnValue(success({ ...service, name: 'Refetch', is_active: false }, true));
  await rendered.rerender(<EditRoute />);
  expect(input(labels.name)).toHaveProp('value', 'Borrador');
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Restaurar servicio' })).toBeEnabled();
  await save();
  await waitFor(() =>
    expect(mutateCall).toHaveBeenCalledWith({ serviceId: service.id, input: { name: 'Borrador' } }),
  );
});
test.each(['service', 'business'] as const)(
  '%s transition never exposes A form as B and initializes B on success',
  async (kind) => {
    const rendered = await renderWithProviders(<EditRoute />);
    await change(labels.name, 'Borrador A');
    if (kind === 'service') paramsMock.mockReturnValue({ id: 'service-b' });
    else businessMock.mockReturnValue(business('business-b'));
    detailMock.mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
    await rendered.rerender(<EditRoute />);
    expect(screen.queryByLabelText(labels.name)).toBeNull();
    detailMock.mockReturnValue(
      success({
        ...service,
        id: 'service-b',
        name: 'Servicio B',
        business_id: kind === 'business' ? 'business-b' : 'business-a',
      }),
    );
    await rendered.rerender(<EditRoute />);
    expect(input(labels.name)).toHaveProp('value', 'Servicio B');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  },
);
test('save pending blocks every action and two immediate keyboard submits cause one update', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  await renderWithProviders(<EditRoute />);
  await change(labels.name, 'Nuevo');
  const onSubmit = input(labels.duration).props.onSubmitEditing;
  await act(async () => {
    onSubmit();
    onSubmit();
  });
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
  for (const label of Object.values(labels)) expect(input(label)).toBeDisabled();
  for (const name of ['Guardar cambios', 'Cancelar', 'Archivar servicio'])
    expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByText('Guardando servicio…')).toHaveProp('role', 'status');
  await press('Archivar servicio');
  await save();
  expect(mutateCall).toHaveBeenCalledTimes(1);
  await act(async () => operation.resolve({ ...service, name: 'Persistido' }));
  await waitFor(() => expect(input(labels.name)).toHaveProp('value', 'Persistido'));
  noNavigation();
});
test.each([true, false])(
  'active=%s has exact confirmation, dismiss does not mutate',
  async (active) => {
    detailMock.mockReturnValue(success({ ...service, is_active: active }));
    await renderWithProviders(<EditRoute />);
    expect(screen.getByText(active ? 'Activo' : 'Archivado')).toBeOnTheScreen();
    await press(active ? 'Archivar servicio' : 'Restaurar servicio');
    expect(
      screen.getByRole('heading', {
        name: active ? '¿Archivar servicio?' : '¿Restaurar servicio?',
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        active
          ? 'El servicio quedará archivado. No se eliminará y podrás restaurarlo.'
          : 'El servicio volverá a estar activo.',
      ),
    ).toBeOnTheScreen();
    await press('Seguir editando');
    expect(mutateCall).not.toHaveBeenCalled();
    expect(screen.queryByText(active ? '¿Archivar servicio?' : '¿Restaurar servicio?')).toBeNull();
  },
);
test.each([true, false])(
  'active=%s status-only write preserves dirty draft and updates returned status on same route',
  async (active) => {
    detailMock.mockReturnValue(success({ ...service, is_active: active }));
    mutateCall.mockResolvedValue({ ...service, is_active: !active });
    await renderWithProviders(<EditRoute />);
    await change(labels.name, 'Borrador sin guardar');
    await change(labels.price, '1.01');
    await press(active ? 'Archivar servicio' : 'Restaurar servicio');
    await press(active ? 'Confirmar archivo' : 'Confirmar restauración');
    await waitFor(() =>
      expect(mutateCall).toHaveBeenCalledWith({
        serviceId: service.id,
        input: { is_active: !active },
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(active ? 'Archivado' : 'Activo')).toBeOnTheScreen(),
    );
    expect(input(labels.name)).toHaveProp('value', 'Borrador sin guardar');
    expect(input(labels.price)).toHaveProp('value', '1.01');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    noNavigation();
    mutateCall.mockResolvedValue({
      ...service,
      name: 'Borrador sin guardar',
      price: 1.01,
      is_active: !active,
    });
    await save();
    await waitFor(() =>
      expect(mutateCall).toHaveBeenLastCalledWith({
        serviceId: service.id,
        input: { name: 'Borrador sin guardar', price: 1.01 },
      }),
    );
  },
);
test.each([true, false])(
  'active=%s pending status prevents save/opposite action/dismiss and no early state flip',
  async (active) => {
    const operation = deferred<ServiceRow>();
    mutateCall.mockReturnValue(operation.promise);
    detailMock.mockReturnValue(success({ ...service, is_active: active }));
    await renderWithProviders(<EditRoute />);
    await change(labels.name, 'Draft');
    await press(active ? 'Archivar servicio' : 'Restaurar servicio');
    await press(active ? 'Confirmar archivo' : 'Confirmar restauración');
    await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole('button', { name: active ? 'Confirmar archivo' : 'Confirmar restauración' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Seguir editando' })).toBeNull();
    expect(
      screen.getByText(active ? 'Activo' : 'Archivado', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await save();
    await press(active ? 'Confirmar archivo' : 'Confirmar restauración');
    expect(mutateCall).toHaveBeenCalledTimes(1);
    await act(async () => operation.resolve({ ...service, is_active: !active }));
    await waitFor(() =>
      expect(screen.getByText(active ? 'Archivado' : 'Activo')).toBeOnTheScreen(),
    );
    noNavigation();
  },
);
test('status success wins over same-identity refetch arriving while operation is pending', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<EditRoute />);
  await press('Archivar servicio');
  await press('Confirmar archivo');
  detailMock.mockReturnValue(success({ ...service, name: 'Refetched' }));
  await rendered.rerender(<EditRoute />);
  await act(async () => operation.resolve({ ...service, is_active: false }));
  await waitFor(() => expect(screen.getByText('Archivado')).toBeOnTheScreen());
});
test.each([
  'SERVICE_NOT_FOUND',
  'SERVICE_ACCESS_DENIED',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
] as const)('update %s retains draft, safe error only, retry and reset on edits', async (code) => {
  mutateCall.mockRejectedValueOnce({
    code,
    message: 'Mensaje seguro',
    details: 'private SQL',
    stack: 'private stack',
  });
  await renderWithProviders(<EditRoute />);
  await change(labels.name, 'Borrador');
  await save();
  expect(await screen.findByRole('alert')).toHaveTextContent('Mensaje seguro');
  expect(screen.queryByText(/private SQL|private stack/)).toBeNull();
  expect(input(labels.name)).toHaveProp('value', 'Borrador');
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  noNavigation();
  const resets = resetCall.mock.calls.length;
  await change(labels.description, 'Texto');
  expect(resetCall.mock.calls.length).toBeGreaterThan(resets);
  expect(screen.queryByRole('alert')).toBeNull();
  await save();
  await waitFor(() => expect(mutateCall).toHaveBeenCalledTimes(2));
  noNavigation();
});
test('archive failure keeps confirmation, safe retry and persisted active state', async () => {
  mutateCall
    .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Reintenta de forma segura' })
    .mockResolvedValueOnce({ ...service, is_active: false });
  await renderWithProviders(<EditRoute />);
  await press('Archivar servicio');
  await press('Confirmar archivo');
  expect(await screen.findByRole('alert')).toHaveTextContent('Reintenta de forma segura');
  expect(screen.getByRole('button', { name: 'Confirmar archivo' })).toBeEnabled();
  await press('Confirmar archivo');
  await waitFor(() => expect(screen.getByText('Archivado')).toBeOnTheScreen());
  expect(mutateCall).toHaveBeenCalledTimes(2);
  noNavigation();
});
test.each([true, false])(
  'cancel history=%s never updates and uses approved safe destination',
  async (hasHistory) => {
    backMock.mockReturnValue(hasHistory);
    await renderWithProviders(<EditRoute />);
    await change(labels.name, 'Descartado');
    await press('Cancelar');
    expect(mutateCall).not.toHaveBeenCalled();
    if (hasHistory) expect(routerMock.back).toHaveBeenCalledTimes(1);
    else expect(routerMock.replace).toHaveBeenCalledWith('/services');
  },
);
test.each(['service', 'business', 'role', 'unmount', 'missing-business'] as const)(
  'late update after %s change cannot apply persisted data to new context',
  async (kind) => {
    const operation = deferred<ServiceRow>();
    mutateCall.mockReturnValue(operation.promise);
    const rendered = await renderWithProviders(<EditRoute />);
    await change(labels.name, 'Draft A');
    await save();
    if (kind === 'unmount') await rendered.unmount();
    else {
      if (kind === 'service') paramsMock.mockReturnValue({ id: 'service-b' });
      if (kind === 'business') businessMock.mockReturnValue(business('business-b'));
      if (kind === 'role') businessMock.mockReturnValue(business('business-a', 'BARBER'));
      if (kind === 'missing-business')
        businessMock.mockReturnValue({
          status: 'idle',
          data: null,
          error: null,
          isFetching: false,
        });
      detailMock.mockReturnValue(success({ ...service, id: 'service-b', name: 'Servicio B' }));
      await rendered.rerender(<EditRoute />);
    }
    await act(async () => operation.resolve({ ...service, name: 'Late A', is_active: false }));
    noNavigation();
    if (kind === 'service' || kind === 'business') {
      expect(input(labels.name)).toHaveProp('value', 'Servicio B');
      expect(screen.getByText('Activo')).toBeOnTheScreen();
    } else if (kind !== 'unmount') expect(screen.queryByLabelText(labels.name)).toBeNull();
  },
);
test('late archive rejection cannot surface in a new business draft', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<EditRoute />);
  await press('Archivar servicio');
  await press('Confirmar archivo');
  businessMock.mockReturnValue(business('business-b'));
  detailMock.mockReturnValue(
    success({ ...service, name: 'Servicio B', business_id: 'business-b' }),
  );
  await rendered.rerender(<EditRoute />);
  await act(async () => operation.reject({ code: 'NETWORK_ERROR', message: 'Error de A' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(input(labels.name)).toHaveProp('value', 'Servicio B');
  noNavigation();
});

test('archiving with an invalid draft sends only status and leaves validation to Save', async () => {
  mutateCall.mockResolvedValue({ ...service, is_active: false });
  await renderWithProviders(<EditRoute />);
  await change(labels.price, '1.001');
  await press('Archivar servicio');
  await press('Confirmar archivo');
  await waitFor(() => expect(screen.getByText('Archivado')).toBeOnTheScreen());
  expect(mutateCall).toHaveBeenCalledWith({ serviceId: service.id, input: { is_active: false } });
  expect(input(labels.price)).toHaveProp('value', '1.001');
  await save();
  await waitFor(() => expect(input(labels.price).props.accessibilityHint).toMatch(/^Error:/));
  expect(mutateCall).toHaveBeenCalledTimes(1);
});

test('persisted archive status survives mutation reset and failed Save before detail refresh', async () => {
  mutateCall
    .mockResolvedValueOnce({ ...service, is_active: false })
    .mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: 'Guardado no disponible' });
  await renderWithProviders(<EditRoute />);
  await press('Archivar servicio');
  await press('Confirmar archivo');
  await waitFor(() => expect(screen.getByText('Archivado')).toBeOnTheScreen());
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  await change(labels.name, 'Draft');
  await save();
  expect(await screen.findByRole('alert')).toHaveTextContent('Guardado no disponible');
  expect(screen.getByText('Archivado')).toBeOnTheScreen();
  expect(input(labels.name)).toHaveProp('value', 'Draft');
});

test('late archive success cannot flip the new business status or clear its draft', async () => {
  const operation = deferred<ServiceRow>();
  mutateCall.mockReturnValue(operation.promise);
  const rendered = await renderWithProviders(<EditRoute />);
  await press('Archivar servicio');
  await press('Confirmar archivo');
  businessMock.mockReturnValue(business('business-b'));
  detailMock.mockReturnValue(success({ ...service, business_id: 'business-b', name: 'B' }));
  await rendered.rerender(<EditRoute />);
  await change(labels.name, 'Draft B');
  await act(async () => operation.resolve({ ...service, is_active: false }));
  expect(input(labels.name)).toHaveProp('value', 'Draft B');
  expect(screen.getByText('Activo')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  noNavigation();
});
