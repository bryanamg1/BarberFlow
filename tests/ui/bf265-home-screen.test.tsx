import * as RN from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { router, useIsFocused } from 'expo-router';
import HomeRoute from '@/app/(app)/(tabs)/index';
import { HomeScreen } from '@/features/analytics/screens/HomeScreen';
import { HomeKpis } from '@/features/analytics/components/HomeKpis';
import { HomeNextAppointment } from '@/features/analytics/components/HomeNextAppointment';
import { HomeTodayAppointments } from '@/features/analytics/components/HomeTodayAppointments';
import { HomeLowStock } from '@/features/analytics/components/HomeLowStock';
import { HomeFinanceSummary } from '@/features/analytics/components/HomeFinanceSummary';
import { useHomeDashboardSummary } from '@/features/analytics/hooks/useHomeDashboardSummary';
import { useNextAppointment } from '@/features/analytics/hooks/useNextAppointment';
import type {
  HomeDashboardSummaryResult,
  HomeNextAppointmentResult,
} from '@/features/analytics/types/home.types';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { agendaContext, agendaRow } from './helpers/agendaFixture';
import { financeSummary } from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: jest.fn() }));
jest.mock('@/features/analytics/hooks/useHomeDashboardSummary', () => ({
  useHomeDashboardSummary: jest.fn(),
}));
jest.mock('@/features/analytics/hooks/useNextAppointment', () => ({
  useNextAppointment: jest.fn(),
}));
jest.mock('@/features/analytics/components/HomeKpis', () => ({
  HomeKpis: jest.fn(({ result }: { result: { status: string } }) => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, { testID: 'widget-kpis' }, 'Kpis:' + result.status);
  }),
}));
jest.mock('@/features/analytics/components/HomeNextAppointment', () => ({
  HomeNextAppointment: jest.fn(({ result }: { result: { status: string } }) => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, { testID: 'widget-next' }, 'Next:' + result.status);
  }),
}));
jest.mock('@/features/analytics/components/HomeTodayAppointments', () => ({
  HomeTodayAppointments: jest.fn(() => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, { testID: 'widget-today' }, 'Today');
  }),
}));
jest.mock('@/features/analytics/components/HomeLowStock', () => ({
  HomeLowStock: jest.fn(() => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, { testID: 'widget-stock' }, 'Stock');
  }),
}));
jest.mock('@/features/analytics/components/HomeFinanceSummary', () => ({
  HomeFinanceSummary: jest.fn(({ result }: { result: { status: string } }) => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, { testID: 'widget-finance' }, 'Finance:' + result.status);
  }),
}));
const summary: HomeDashboardSummaryResult = { status: 'success', data: financeSummary() };
const next: HomeNextAppointmentResult = { status: 'success', data: agendaRow() };
const order = () => screen.queryAllByTestId(/^widget-/).map((n) => n.props.testID);
const nextProps = () => jest.mocked(HomeNextAppointment).mock.calls.at(-1)![0];
const financeProps = () => jest.mocked(HomeFinanceSummary).mock.calls.at(-1)![0];
beforeEach(() => {
  agendaContext();
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(useHomeDashboardSummary).mockReturnValue(summary);
  jest.mocked(useNextAppointment).mockReturnValue(next);
  jest
    .mocked(HomeKpis)
    .mockImplementation(({ result }) => (
      <RN.Text testID="widget-kpis">{'Kpis:' + result.status}</RN.Text>
    ));
  jest
    .mocked(HomeNextAppointment)
    .mockImplementation(({ result }) => (
      <RN.Text testID="widget-next">{'Next:' + result.status}</RN.Text>
    ));
  jest
    .mocked(HomeTodayAppointments)
    .mockImplementation(() => <RN.Text testID="widget-today">Today</RN.Text>);
  jest
    .mocked(HomeLowStock)
    .mockImplementation(() => <RN.Text testID="widget-stock">Stock</RN.Text>);
  jest
    .mocked(HomeFinanceSummary)
    .mockImplementation(({ result }) => (
      <RN.Text testID="widget-finance">{'Finance:' + result.status}</RN.Text>
    ));
});

test('existing Home route exports the new screen directly', () =>
  expect(HomeRoute).toBe(HomeScreen));

test('OWNER exact tree order, one summary/next call and unchanged shared result identity', async () => {
  await render(<HomeScreen />);
  expect(screen.getByRole('heading', { name: 'Inicio' })).toBeTruthy();
  expect(order()).toEqual([
    'widget-kpis',
    'widget-next',
    'widget-today',
    'widget-finance',
    'widget-stock',
  ]);
  expect(useHomeDashboardSummary).toHaveBeenCalledTimes(1);
  expect(useNextAppointment).toHaveBeenCalledTimes(1);
  expect(jest.mocked(HomeKpis).mock.calls[0][0].result).toBe(summary);
  expect(financeProps().result).toBe(summary);
  expect(nextProps().result).toBe(next);
  expect(HomeTodayAppointments).toHaveBeenCalledTimes(1);
  expect(HomeLowStock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Configuración')).toBeNull();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test('BARBER exact operational order without financial subtree or placeholder, hooks unconditional', async () => {
  agendaContext({ role: 'BARBER' });
  await render(<HomeScreen />);
  expect(order()).toEqual(['widget-next', 'widget-today', 'widget-stock']);
  expect(HomeKpis).not.toHaveBeenCalled();
  expect(HomeFinanceSummary).not.toHaveBeenCalled();
  expect(screen.queryByText(/financiero|Indicadores no disponibles/i)).toBeNull();
  expect(useHomeDashboardSummary).toHaveBeenCalledTimes(1);
  expect(useNextAppointment).toHaveBeenCalledTimes(1);
});

test.each([
  'logout',
  'initializing',
  'recovering',
  'business-pending',
  'business-idle',
  'business-error',
  'revalidating',
  'unsupported-role',
  'missing-user',
  'missing-business',
  'missing-member',
])('%s structural context does not mount any widget', async (mode) => {
  if (mode === 'logout')
    jest
      .mocked(useAuth)
      .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  if (mode === 'initializing')
    jest
      .mocked(useAuth)
      .mockReturnValue({ status: 'initializing', user: null, session: null, error: null });
  if (mode === 'recovering')
    jest
      .mocked(useAuth)
      .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
  if (mode === 'business-pending')
    jest
      .mocked(useBusiness)
      .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: false });
  if (mode === 'business-idle')
    jest
      .mocked(useBusiness)
      .mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
  if (mode === 'business-error')
    jest.mocked(useBusiness).mockReturnValue({
      status: 'error',
      data: null,
      error: { code: 'UNKNOWN_ERROR', message: 'Error seguro' },
      isFetching: false,
    } as ReturnType<typeof useBusiness>);
  if (mode === 'revalidating')
    jest
      .mocked(useBusiness)
      .mockReturnValue({ ...useBusiness(), isFetching: true } as ReturnType<typeof useBusiness>);
  if (mode === 'unsupported-role') {
    const b = useBusiness();
    if (b.status !== 'success') throw Error('fixture');
    jest
      .mocked(useBusiness)
      .mockReturnValue({ ...b, data: { ...b.data, role: 'ADMIN' } } as unknown as ReturnType<
        typeof useBusiness
      >);
  }
  if (mode === 'missing-user') agendaContext({ userId: '' });
  if (mode === 'missing-business') agendaContext({ businessId: '' });
  if (mode === 'missing-member') agendaContext({ membershipId: '' });
  await render(<HomeScreen />);
  expect(order()).toEqual([]);
  expect(screen.getByRole('heading', { name: 'Inicio' })).toBeTruthy();
  if (mode === 'business-pending' || mode === 'revalidating')
    expect(screen.getByText('Cargando negocio…')).toBeTruthy();
  if (mode === 'initializing') expect(screen.getByText('Verificando sesión…')).toBeTruthy();
  if (mode === 'business-error') expect(screen.getByText('Error seguro')).toBeTruthy();
});

const results: [string, HomeNextAppointmentResult][] = [
  ['loading', { status: 'loading' }],
  ['error', { status: 'error' }],
  ['unavailable', { status: 'unavailable' }],
  ['success-null', { status: 'success', data: null }],
  ['success', { status: 'success', data: agendaRow() }],
];
test.each(results)(
  'Next %s is forwarded unchanged and does not gate siblings',
  async (_name, result) => {
    jest.mocked(useNextAppointment).mockReturnValue(result);
    await render(<HomeScreen />);
    expect(nextProps().result).toBe(result);
    expect(order()).toEqual([
      'widget-kpis',
      'widget-next',
      'widget-today',
      'widget-finance',
      'widget-stock',
    ]);
  },
);

test.each(['loading', 'error', 'unavailable'] as const)(
  'summary %s is shared unchanged without suppressing operational siblings',
  async (status) => {
    const result: HomeDashboardSummaryResult = { status };
    jest.mocked(useHomeDashboardSummary).mockReturnValue(result);
    await render(<HomeScreen />);
    expect(jest.mocked(HomeKpis).mock.calls[0][0].result).toBe(result);
    expect(financeProps().result).toBe(result);
    expect(screen.getByText('Next:success')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Stock')).toBeTruthy();
  },
);

test('host callbacks push the exact existing destinations and ID', async () => {
  await render(<HomeScreen />);
  await act(() => nextProps().onOpen('appt-42'));
  expect(router.push).toHaveBeenNthCalledWith(1, {
    pathname: '/appointments/[id]',
    params: { id: 'appt-42' },
  });
  await act(() => financeProps().onOpenFinances());
  expect(router.push).toHaveBeenNthCalledWith(2, '/finances');
});

test.each(['business', 'member', 'user', 'role', 'blur', 'logout', 'revalidating'])(
  'captured host callbacks cannot navigate after %s changes',
  async (mode) => {
    const view = await render(<HomeScreen />);
    const oldNext = nextProps().onOpen,
      oldFinance = financeProps().onOpenFinances;
    if (mode === 'business') agendaContext({ businessId: 'b2' });
    if (mode === 'member') agendaContext({ membershipId: 'm2' });
    if (mode === 'user') agendaContext({ userId: 'u2' });
    if (mode === 'role') agendaContext({ role: 'BARBER' });
    if (mode === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
    if (mode === 'revalidating')
      jest.mocked(useBusiness).mockReturnValue({
        ...useBusiness(),
        isFetching: true,
      } as ReturnType<typeof useBusiness>);
    if (mode === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    await view.rerender(<HomeScreen />);
    await act(() => {
      oldNext('old');
      oldFinance();
    });
    expect(router.push).not.toHaveBeenCalled();
  },
);

test('captured callbacks cannot navigate after unmount', async () => {
  const view = await render(<HomeScreen />),
    oldNext = nextProps().onOpen,
    oldFinance = financeProps().onOpenFinances;
  await view.unmount();
  await act(() => {
    oldNext('old');
    oldFinance();
  });
  expect(router.push).not.toHaveBeenCalled();
});

test('revalidation completion permits fresh callbacks but never revives an old callback', async () => {
  const business = useBusiness();
  if (business.status !== 'success') throw new Error('Expected a loaded business fixture');
  const view = await render(<HomeScreen />);
  const oldNext = nextProps().onOpen;
  jest.mocked(useBusiness).mockReturnValue({ ...business, isFetching: true });
  await view.rerender(<HomeScreen />);
  jest.mocked(useBusiness).mockReturnValue(business);
  await view.rerender(<HomeScreen />);
  await act(() => oldNext('old'));
  expect(router.push).not.toHaveBeenCalled();
  await act(() => nextProps().onOpen('fresh'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/appointments/[id]',
    params: { id: 'fresh' },
  });
});

test('host content uses approved width cap/padding/gap and default single-column order', async () => {
  await render(<HomeScreen />);
  const scrolls = screen.root?.queryAll((n) => n.props.contentContainerStyle !== undefined);
  expect(scrolls).toHaveLength(1);
  const content = scrolls![0];
  expect(content).toBeTruthy();
  expect(RN.StyleSheet.flatten(content.props.contentContainerStyle)).toEqual({
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  });
  expect(content.props.refreshControl).toBeUndefined();
  expect(content.props.horizontal).toBeUndefined();
  expect(order()).toEqual([
    'widget-kpis',
    'widget-next',
    'widget-today',
    'widget-finance',
    'widget-stock',
  ]);
});
