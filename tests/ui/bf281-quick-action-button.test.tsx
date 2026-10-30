import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Tabs, router, useIsFocused, usePathname } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { CenterQuickActionButton } from '@/features/navigation/components/CenterQuickActionButton';
import { NavigationTabs } from '@/features/navigation/components/NavigationTabs';
import { theme } from '@/theme';
import { agendaContext } from './helpers/agendaFixture';
import { NavigationTabsDouble, type TestTabScreen } from './helpers/navigationFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-symbols', () => ({ SymbolView: jest.fn(() => null) }));
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
const tabsMock = jest.mocked(Tabs);
const quickProps = () => {
  const p = tabsMock.mock.calls.at(-1)![0];
  const child = React.Children.toArray(p.children).find(
    (x) => React.isValidElement<TestTabScreen>(x) && x.props.name === 'quick-action',
  ) as React.ReactElement<TestTabScreen>;
  return child.props;
};
const triggerProps = () =>
  (
    quickProps().options.tabBarButton!() as React.ReactElement<{
      onPress: () => void;
      open: boolean;
    }>
  ).props;
beforeEach(() => {
  agendaContext();
  jest.mocked(usePathname).mockReturnValue('/agenda');
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, left: 0, right: 0, bottom: 0 });
  tabsMock.mockImplementation(({ children }) => (
    <NavigationTabsDouble>{children}</NavigationTabsDouble>
  ));
});

test.each([false, true])(
  'pure trigger open=%s has exact role/label/expanded/icon and FAB token',
  async (open) => {
    const press = jest.fn();
    await render(<CenterQuickActionButton open={open} onPress={press} />);
    const button = screen.getByRole('button', { name: 'Acciones rápidas', expanded: open });
    expect(button.props.accessibilityState.expanded).toBe(open);
    expect(button).toHaveStyle({
      width: theme.sizing.fab,
      height: theme.sizing.fab,
      minHeight: theme.sizing.touchTarget,
      minWidth: theme.sizing.touchTarget,
      backgroundColor: open ? theme.colors.primaryPressed : theme.colors.primary,
    });
    expect(theme.sizing.fab).toBeGreaterThanOrEqual(theme.sizing.touchTargetMin);
    expect(jest.mocked(SymbolView).mock.calls.at(-1)![0].name).toEqual({
      ios: 'plus',
      android: 'add',
      web: 'add',
    });
    await fireEvent.press(button);
    expect(press).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  },
);

test('disabled trigger exposes state, ignores press and retains plus', async () => {
  const press = jest.fn();
  await render(<CenterQuickActionButton open disabled onPress={press} />);
  const button = screen.getByRole('button', { name: 'Acciones rápidas', disabled: true });
  await fireEvent.press(button);
  expect(press).not.toHaveBeenCalled();
  expect(button).toHaveStyle({ backgroundColor: theme.colors.surfaceStrong });
});

test('trigger has visible focus from the existing shared primitive', async () => {
  await render(<CenterQuickActionButton open={false} onPress={() => undefined} />);
  const button = screen.getByRole('button', { name: 'Acciones rápidas' });
  await fireEvent(button, 'focus', {});
  expect(button).toHaveStyle({
    borderColor: theme.colors.primary,
    borderWidth: theme.borderWidths.thin,
  });
});

test.each(['OWNER', 'BARBER'] as const)(
  '%s host places button between Agenda/Clientes without a tab action',
  async (role) => {
    agendaContext({ role });
    await render(<NavigationTabs />);
    expect(screen.getAllByRole('tab').map((x) => x.props.accessibilityLabel)).toEqual([
      'Inicio',
      'Agenda',
      'Clientes',
      'Finanzas',
    ]);
    expect(
      React.Children.toArray(tabsMock.mock.calls.at(-1)![0].children).map(
        (x) => (x as React.ReactElement<TestTabScreen>).props.name,
      ),
    ).toEqual(['index', 'agenda', 'quick-action', 'clients', 'finances']);
    expect(screen.queryByRole('tab', { name: 'Quick Action' })).toBeNull();
    expect(quickProps().options).toMatchObject({
      tabBarItemStyle: {
        minHeight: theme.sizing.touchTarget,
        alignItems: 'center',
        justifyContent: 'center',
      },
    });
    const trigger = screen.getByRole('button', { name: 'Acciones rápidas', expanded: false });
    expect(trigger.props.href).toBeUndefined();
    await fireEvent.press(trigger);
    expect(screen.getByRole('button', { name: 'Acciones rápidas', expanded: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Agenda', selected: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
    expect(screen.getByRole('button', { name: 'Acciones rápidas', expanded: false })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Agenda', selected: true })).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  },
);

test.each(['logout', 'pending', 'fetching', 'unsupported'] as const)(
  '%s context cannot expose a trigger',
  async (state) => {
    if (state === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', session: null, user: null, error: null });
    else if (state === 'pending')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
    else {
      const b = useBusiness();
      if (b.status !== 'success') throw Error('fixture');
      jest
        .mocked(useBusiness)
        .mockReturnValue(
          state === 'fetching'
            ? { ...b, isFetching: true }
            : ({ ...b, data: { ...b.data, role: 'OTHER' } } as unknown as ReturnType<
                typeof useBusiness
              >),
        );
    }
    await render(<NavigationTabs />);
    expect(screen.queryByRole('button', { name: 'Acciones rápidas' })).toBeNull();
  },
);

test('route change closes and permanently invalidates captured trigger callbacks', async () => {
  const view = await render(<NavigationTabs />),
    old = triggerProps().onPress;
  await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
  jest.mocked(usePathname).mockReturnValue('/clients');
  await view.rerender(<NavigationTabs />);
  await act(() => old());
  expect(screen.getByRole('button', { name: 'Acciones rápidas', expanded: false })).toBeTruthy();
  expect(router.push).not.toHaveBeenCalled();
});

test.each([0, 34])('existing default tab-bar inset %s is applied once', async (bottom) => {
  jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, left: 0, right: 0, bottom });
  await render(<NavigationTabs />);
  const p = tabsMock.mock.calls.at(-1)![0];
  expect(p.screenOptions).toMatchObject({
    tabBarStyle: { height: theme.sizing.touchTarget + theme.spacing[32] + bottom },
  });
});
