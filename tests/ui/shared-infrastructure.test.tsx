import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useRouter } from 'expo-router';
import { useEffect, type PropsWithChildren } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { clearTestQueryClients, createTestQueryClient } from '@/test/createTestQueryClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));

function CacheProbe() {
  const client = useQueryClient();
  const { data } = useQuery<string>({ queryKey: ['proof'], queryFn: skipToken });
  return (
    <View>
      <Text>{data ?? 'Empty cache'}</Text>
      <Button label="Write cache" onPress={() => client.setQueryData(['proof'], 'Updated cache')} />
    </View>
  );
}

function QueryProbe({ load }: { load: () => Promise<string[]> }) {
  const query = useQuery({ queryKey: ['async-proof'], queryFn: load });
  if (query.isPending) return <Text>Loading</Text>;
  if (query.isError) return <Text role="alert">{query.error.message}</Text>;
  return <Text>{query.data.length ? query.data.join(', ') : 'No results'}</Text>;
}

function FormProbe({ submit }: { submit: (value: { name: string }) => Promise<void> }) {
  const { control, handleSubmit, setError, formState } = useForm({ defaultValues: { name: '' } });
  const onSubmit = handleSubmit(async (value) => {
    try {
      await submit(value);
    } catch {
      setError('root', { message: 'Submission failed' });
    }
  });
  return (
    <View>
      <Controller
        control={control}
        name="name"
        rules={{ required: 'Name required' }}
        render={({ field, fieldState }) => (
          <Input
            label="Name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />
      {formState.errors.root && <Text role="alert">{formState.errors.root.message}</Text>}
      <Button label="Submit" loading={formState.isSubmitting} onPress={() => void onSubmit()} />
    </View>
  );
}

describe('shared component test infrastructure', () => {
  test('creates independent clients with query/mutation retries disabled and no GC timers', () => {
    const first = createTestQueryClient();
    const second = createTestQueryClient();
    expect(first).not.toBe(second);
    first.setQueryData(['proof'], 'First only');
    expect(second.getQueryData(['proof'])).toBeUndefined();
    expect(first.getDefaultOptions()).toEqual({
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    });
  });

  test('renders a real primitive and reads/writes an injected cache', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['proof'], 'Initial cache');
    const rendered = await renderWithProviders(<CacheProbe />, { queryClient });
    expect(rendered.queryClient).toBe(queryClient);
    expect(screen.getByText('Initial cache')).toBeOnTheScreen();
    await userEvent.press(screen.getByRole('button', { name: 'Write cache' }));
    expect(await screen.findByText('Updated cache')).toBeOnTheScreen();
    expect(queryClient.getQueryData(['proof'])).toBe('Updated cache');
    await queryClient.invalidateQueries({ queryKey: ['proof'] });
    expect(queryClient.getQueryState(['proof'])?.isInvalidated).toBe(true);
  });

  test('default renders do not share a cache', async () => {
    const first = await renderWithProviders(<CacheProbe />);
    await fireEvent.press(screen.getByRole('button', { name: 'Write cache' }));
    await screen.findByText('Updated cache');
    await first.unmount();
    const second = await renderWithProviders(<CacheProbe />);
    expect(second.queryClient).not.toBe(first.queryClient);
    expect(screen.getByText('Empty cache')).toBeOnTheScreen();
  });

  test('cleanup clears registered query and mutation caches', async () => {
    const client = createTestQueryClient();
    client.setQueryData(['proof'], 'Cached');
    await client
      .getMutationCache()
      .build(client, { mutationFn: async () => 'Saved' })
      .execute(undefined);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    clearTestQueryClients();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  test('supports an additional consumer provider and deterministic unmount', async () => {
    const disposed = jest.fn();
    function ConsumerWrapper({ children }: PropsWithChildren) {
      useEffect(() => disposed, []);
      return (
        <View>
          <Text>Consumer wrapper</Text>
          {children}
        </View>
      );
    }
    const rendered = await renderWithProviders(<Text>Content</Text>, { wrapper: ConsumerWrapper });
    expect(screen.getByText('Consumer wrapper')).toBeOnTheScreen();
    await rendered.unmount();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  test('records push, replace and back through both Expo Router APIs and resets spies', async () => {
    function NavigationProbe() {
      const navigation = useRouter();
      return (
        <View>
          <Button label="Push" onPress={() => navigation.push('/login')} />
          <Button label="Replace" onPress={() => router.replace('/auth/recovery')} />
          <Button label="Back" onPress={() => navigation.back()} />
        </View>
      );
    }
    await renderWithProviders(<NavigationProbe />);
    for (const name of ['Push', 'Replace', 'Back']) {
      await fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(routerMock.push).toHaveBeenCalledWith('/login');
    expect(routerMock.replace).toHaveBeenCalledWith('/auth/recovery');
    expect(routerMock.back).toHaveBeenCalledTimes(1);
    resetRouterMocks();
    for (const spy of Object.values(routerMock)) expect(spy).not.toHaveBeenCalled();
  });

  test('router spies begin each test without calls or custom implementations', () => {
    for (const spy of Object.values(routerMock)) {
      expect(spy).not.toHaveBeenCalled();
      expect(spy.getMockImplementation()).toBeUndefined();
    }
  });

  test('awaits a pending query and exposes an empty result without sleeps', async () => {
    let complete!: (value: string[]) => void;
    const response = new Promise<string[]>((resolve) => {
      complete = resolve;
    });
    const load = jest.fn(() => response);
    await renderWithProviders(<QueryProbe load={load} />);
    expect(screen.getByText('Loading')).toBeOnTheScreen();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => {
      complete([]);
    });
    expect(await screen.findByText('No results')).toBeOnTheScreen();
  });

  test('shows a query error after one attempt', async () => {
    const load = jest.fn(async () => {
      throw new Error('Synthetic read failure');
    });
    await renderWithProviders(<QueryProbe load={load} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic read failure');
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('runs RHF validation, changeText, async pending submission and safe error feedback', async () => {
    let reject!: (reason: Error) => void;
    const response = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const submit = jest.fn(() => response);
    await renderWithProviders(<FormProbe submit={submit} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Error: Name required')).toBeOnTheScreen();
    expect(submit).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Synthetic name');
    await fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Synthetic name' }));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeBusy();
    await act(async () => {
      reject(new Error('Synthetic service failure'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Submission failed');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('Synthetic name');
  });

  test('lets consumers mock public Auth and Business state unions without real providers', async () => {
    const authMock: jest.MockedFunction<typeof useAuth> = jest.mocked(useAuth);
    const businessMock: jest.MockedFunction<typeof useBusiness> = jest.mocked(useBusiness);
    const user = {
      id: 'synthetic-user',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00Z',
    };
    const session = {
      user,
      access_token: 'synthetic-not-a-token',
      refresh_token: 'synthetic-not-a-token',
      expires_in: 3600,
      token_type: 'bearer' as const,
    };
    const authStates: AuthState[] = [
      { status: 'initializing', session: null, user: null, error: null },
      { status: 'authenticated', session, user, error: null },
      { status: 'recovering', session, user, error: null },
      { status: 'unauthenticated', session: null, user: null, error: null },
      {
        status: 'error',
        session: null,
        user: null,
        error: { code: 'NETWORK_ERROR', message: 'Synthetic auth error' },
      },
    ];
    const businessStates: BusinessContextValue[] = [
      { status: 'idle', data: null, error: null, isFetching: false },
      { status: 'pending', data: null, error: null, isFetching: true },
      {
        status: 'success',
        data: {
          membershipId: 'synthetic-membership',
          role: 'OWNER',
          business: {
            id: 'synthetic-business',
            name: 'Synthetic business',
            currency_code: 'ARS',
            timezone: 'America/Argentina/Buenos_Aires',
            is_active: true,
          },
        },
        error: null,
        isFetching: false,
      },
      {
        status: 'error',
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'Synthetic business error' },
        isFetching: false,
      },
    ];
    function ContextConsumer() {
      return (
        <Text>
          {useAuth().status}/{useBusiness().status}
        </Text>
      );
    }
    authMock.mockReturnValue(authStates[0]);
    businessMock.mockReturnValue(businessStates[0]);
    const rendered = await renderWithProviders(<ContextConsumer />);
    for (const auth of authStates) {
      for (const business of businessStates) {
        authMock.mockReturnValue(auth);
        businessMock.mockReturnValue(business);
        await rendered.rerender(<ContextConsumer />);
        expect(screen.getByText(`${auth.status}/${business.status}`)).toBeOnTheScreen();
      }
    }
  });

  test('propagates render failures to the caller', async () => {
    const failure = new Error('Synthetic render failure');
    function Broken(): never {
      throw failure;
    }
    await expect(renderWithProviders(<Broken />)).rejects.toThrow(failure);
  });
});
