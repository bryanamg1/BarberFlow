import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Tabs, router, useIsFocused, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { NavigationTabs } from '@/features/navigation/components/NavigationTabs';
import { QuickActionSheet } from '@/features/navigation/components/QuickActionSheet';
import type { QuickActionId } from '@/features/navigation/quickActions';
import { theme } from '@/theme';
import { agendaContext } from './helpers/agendaFixture';
import { NavigationTabsDouble, type TestTabScreen } from './helpers/navigationFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: jest.fn(),
  useIsFocused: jest.fn(),
  Tabs: Object.assign(jest.fn(), { Screen: () => null }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: jest.fn(),
}));
jest.mock('@/features/navigation/components/QuickActionSheet', () => {
  const actual = jest.requireActual<
    typeof import('@/features/navigation/components/QuickActionSheet')
  >('@/features/navigation/components/QuickActionSheet');
  return { ...actual, QuickActionSheet: jest.fn(actual.QuickActionSheet) };
});
const cases = [
  ['NEW_APPOINTMENT', 'Nuevo turno', '/appointments/new'],
  ['NEW_CLIENT', 'Nuevo cliente', '/clients/new'],
  ['NEW_SALE', 'Nueva venta', '/sales/new'],
  ['NEW_EXPENSE', 'Nuevo gasto', '/expenses/new'],
  ['NEW_PURCHASE', 'Ingresar mercadería', '/purchases/new'],
] as const;
const sheetProps = () => jest.mocked(QuickActionSheet).mock.calls.at(-1)![0];
const triggerProps = () => {
  const p = jest.mocked(Tabs).mock.calls.at(-1)![0];
  const c = React.Children.toArray(p.children).find(
    (x) => React.isValidElement<TestTabScreen>(x) && x.props.name === 'quick-action',
  ) as React.ReactElement<TestTabScreen>;
  return (c.props.options.tabBarButton!() as React.ReactElement<{ onPress: () => void }>).props;
};
const open = async () => {
  const view = await render(<NavigationTabs />);
  await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
  return view;
};
beforeEach(() => {
  agendaContext();
  jest.mocked(usePathname).mockReturnValue('/agenda');
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, left: 0, right: 0, bottom: 0 });
  jest
    .mocked(Tabs)
    .mockImplementation(({ children }) => <NavigationTabsDouble>{children}</NavigationTabsDouble>);
  jest
    .mocked(QuickActionSheet)
    .mockImplementation(
      jest.requireActual<typeof import('@/features/navigation/components/QuickActionSheet')>(
        '@/features/navigation/components/QuickActionSheet',
      ).QuickActionSheet,
    );
});

test.each(['OWNER', 'BARBER'] as const)(
  'controlled %s sheet has exact ordered accessible actions, no extras or router',
  async (role) => {
    const select = jest.fn(),
      close = jest.fn();
    await render(<QuickActionSheet visible role={role} onClose={close} onSelect={select} />);
    expect(screen.getByRole('heading', { name: 'Acciones rápidas' })).toBeTruthy();
    const labels = screen
      .getAllByRole('button')
      .map((x) => x.props.accessibilityLabel)
      .filter((x) => x !== 'Cerrar');
    expect(labels).toEqual(cases.slice(0, role === 'OWNER' ? 5 : 2).map((c) => c[1]));
    for (const c of cases.slice(0, role === 'OWNER' ? 5 : 2)) {
      await fireEvent.press(screen.getByRole('button', { name: c[1] }));
      expect(select).toHaveBeenLastCalledWith(c[0]);
    }
    expect(select).toHaveBeenCalledTimes(role === 'OWNER' ? 5 : 2);
    expect(close).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  },
);
test('hidden sheet renders no dialog content', async () => {
  await render(
    <QuickActionSheet
      visible={false}
      role="OWNER"
      onClose={() => undefined}
      onSelect={() => undefined}
    />,
  );
  expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
test('dismiss emits onClose without internally copying visible', async () => {
  const close = jest.fn(),
    props = { role: 'OWNER' as const, onClose: close, onSelect: () => undefined };
  const view = await render(<QuickActionSheet {...props} visible />);
  await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'Acciones rápidas' })).toBeTruthy();
  await view.rerender(<QuickActionSheet {...props} visible={false} />);
  expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
});
test.each(cases)(
  'OWNER %s closes the real sheet before one exact pathname navigation',
  async (id, label, route) => {
    await open();
    jest.mocked(router.push).mockImplementation(() => {
      expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
    });
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(route);
    expect(screen.getByRole('tab', { name: 'Agenda', selected: true })).toBeTruthy();
  },
);
test.each(cases.slice(0, 2))('BARBER %s routes through the host', async (id, label, route) => {
  agendaContext({ role: 'BARBER' });
  await open();
  await fireEvent.press(screen.getByRole('button', { name: label }));
  expect(router.push).toHaveBeenCalledWith(route);
});
test.each(['NEW_SALE', 'NEW_EXPENSE', 'NEW_PURCHASE', 'UNKNOWN'] as const)(
  'BARBER host rejects injected %s even though its row is absent',
  async (action) => {
    agendaContext({ role: 'BARBER' });
    await open();
    await act(() => sheetProps().onSelect(action as QuickActionId));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
  },
);
test.each(['backdrop', 'system-back', 'accessibility-escape'] as const)(
  '%s uses shared dismiss without changing tab',
  async (kind) => {
    await open();
    const nodes = screen.container.queryAll((n) =>
      kind === 'system-back'
        ? typeof n.props.onRequestClose === 'function'
        : kind === 'accessibility-escape'
          ? typeof n.props.onAccessibilityEscape === 'function'
          : typeof n.props.onResponderRelease === 'function' &&
            StyleSheet.flatten(n.props.style)?.backgroundColor === theme.colors.overlay,
    );
    expect(nodes?.length).toBeGreaterThan(0);
    const callback =
      kind === 'system-back'
        ? nodes![0].props.onRequestClose
        : kind === 'accessibility-escape'
          ? nodes![0].props.onAccessibilityEscape
          : nodes![0].props.onResponderRelease;
    await act(() => callback());
    expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Agenda', selected: true })).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  },
);
test('synchronous repeated selections and captured trigger press cannot duplicate/reopen navigation', async () => {
  await open();
  const select = sheetProps().onSelect,
    toggle = triggerProps().onPress;
  await act(() => {
    select('NEW_CLIENT');
    select('NEW_APPOINTMENT');
    toggle();
  });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/clients/new');
  expect(screen.getByRole('button', { name: 'Acciones rápidas', disabled: true })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
});
test.each([
  'route',
  'business',
  'membership',
  'user',
  'role',
  'logout',
  'fetching',
  'blur',
] as const)('%s closes and invalidates captured action/trigger', async (change) => {
  const view = await open(),
    select = sheetProps().onSelect,
    toggle = triggerProps().onPress;
  if (change === 'route') jest.mocked(usePathname).mockReturnValue('/clients');
  if (change === 'business') agendaContext({ businessId: 'other' });
  if (change === 'membership') agendaContext({ membershipId: 'other' });
  if (change === 'user') agendaContext({ userId: 'other' });
  if (change === 'role') agendaContext({ role: 'BARBER' });
  if (change === 'logout')
    jest
      .mocked(useAuth)
      .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  if (change === 'blur') jest.mocked(useIsFocused).mockReturnValue(false);
  if (change === 'fetching') {
    const b = useBusiness();
    if (b.status !== 'success') throw Error('fixture');
    jest.mocked(useBusiness).mockReturnValue({ ...b, isFetching: true });
  }
  await view.rerender(<NavigationTabs />);
  await act(() => {
    select('NEW_SALE');
    toggle();
  });
  expect(router.push).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
});
test('unmount invalidates action and trigger callbacks', async () => {
  const view = await open(),
    select = sheetProps().onSelect,
    toggle = triggerProps().onPress;
  await view.unmount();
  await act(() => {
    select('NEW_CLIENT');
    toggle();
  });
  expect(router.push).not.toHaveBeenCalled();
});
test('a dismissed opening cannot navigate or select a later opening', async () => {
  await open();
  const old = sheetProps().onSelect;
  await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
  await act(() => old('NEW_CLIENT'));
  await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
  await act(() => old('NEW_CLIENT'));
  expect(router.push).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Nuevo cliente' }));
  expect(router.push).toHaveBeenCalledTimes(1);
});
test('StrictMode does not replay a selected navigation', async () => {
  await render(
    <React.StrictMode>
      <NavigationTabs />
    </React.StrictMode>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Nuevo cliente' }));
  expect(router.push).toHaveBeenCalledTimes(1);
});
test('local router rejection leaves sheet closed and allows a fresh explicit intention without error UI', async () => {
  jest.mocked(router.push).mockImplementation(() => {
    throw Error('private transport detail');
  });
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Nuevo cliente' }));
  expect(screen.getByRole('button', { name: 'Acciones rápidas', disabled: false })).toBeTruthy();
  expect(screen.queryByText('private transport detail')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
  expect(screen.getByRole('heading', { name: 'Acciones rápidas' })).toBeTruthy();
});
