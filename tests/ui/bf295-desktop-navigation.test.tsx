import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { Tabs, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NavigationTabs } from '@/features/navigation/components/NavigationTabs';
import { theme } from '@/theme';
import { agendaContext } from './helpers/agendaFixture';
import { NavigationTabsDouble, type TestTabScreen } from './helpers/navigationFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: () => '/agenda',
  useIsFocused: () => true,
  Tabs: Object.assign(jest.fn(), { Screen: () => null }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: jest.fn(),
}));
const original = Dimensions.get('window');
const widths = [320, 390, 767, 768, 1024, 1200, 1280];
const resize = async (width: number) =>
  act(() => Dimensions.set({ window: { ...original, width } }));
const tabProps = () => jest.mocked(Tabs).mock.calls.at(-1)![0];
const actions = [
  'Nuevo turno',
  'Nuevo cliente',
  'Nueva venta',
  'Nuevo gasto',
  'Ingresar mercadería',
];
beforeEach(() => {
  agendaContext();
  jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, left: 0, right: 0, bottom: 34 });
  jest
    .mocked(Tabs)
    .mockImplementation(({ children }) => <NavigationTabsDouble>{children}</NavigationTabsDouble>);
});
afterEach(async () => resize(original.width));

function expectNativeSheet(visible: boolean) {
  expect(screen.container.queryAll((node) => node.type === 'Modal')).toHaveLength(visible ? 1 : 0);
  expect(
    screen.container.queryAll((node) => node.props.accessibilityViewIsModal === true),
  ).toHaveLength(visible ? 1 : 0);
  expect(
    screen.getByRole('button', { name: 'Acciones rápidas' }).props.accessibilityState.expanded,
  ).toBe(visible);
  if (visible) {
    expect(screen.getByRole('heading', { name: 'Acciones rápidas' })).toBeTruthy();
  } else {
    expect(screen.queryByRole('heading', { name: 'Acciones rápidas' })).toBeNull();
  }
}

describe.each(['OWNER', 'BARBER'] as const)('%s', (role) => {
  test.each(widths)(
    'width %s preserves five registered destinations, active state and action permissions',
    async (width) => {
      agendaContext({ role });
      await resize(width);
      await render(<NavigationTabs />);
      const props = tabProps(),
        options = props.screenOptions;
      if (!options || typeof options === 'function') {
        throw new Error('Expected static navigation screenOptions');
      }
      const barStyle = StyleSheet.flatten(options.tabBarStyle);
      if (!barStyle || !('height' in barStyle)) {
        throw new Error('Expected static navigation tabBarStyle with height');
      }
      expect(
        React.Children.toArray(props.children).flatMap((n) =>
          React.isValidElement<TestTabScreen>(n) ? [n.props.name] : [],
        ),
      ).toEqual(['index', 'agenda', 'quick-action', 'clients', 'finances']);
      expect(options.tabBarLabelPosition).toBe(width >= 768 ? 'beside-icon' : 'below-icon');
      expect(barStyle.height).toBe(theme.sizing.touchTarget + theme.spacing[32] + 34);
      expect(barStyle.maxWidth).toBe(width >= 768 ? 1200 : undefined);
      expect(barStyle.alignSelf).toBe(width >= 768 ? 'center' : undefined);
      expect(barStyle.width).toBe(width >= 768 ? '100%' : undefined);
      expect(screen.getAllByRole('tab')).toHaveLength(4);
      expect(screen.getByRole('tab', { name: 'Agenda' }).props.accessibilityState.selected).toBe(
        true,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
      expectNativeSheet(true);
      expect(actions.filter((label) => screen.queryByRole('button', { name: label }))).toEqual(
        role === 'OWNER' ? actions : actions.slice(0, 2),
      );
      expect(router.push).not.toHaveBeenCalled();
    },
  );
});

test('actual resizes preserve active tab, existing QuickAction opening and a single navigator', async () => {
  await resize(390);
  await render(<NavigationTabs />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Clientes' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
  for (const width of widths) {
    await resize(width);
    expect(screen.getByRole('tab', { name: 'Clientes' }).props.accessibilityState.selected).toBe(
      true,
    );
    expect(
      screen.getByRole('button', { name: 'Acciones rápidas' }).props.accessibilityState.expanded,
    ).toBe(true);
    expectNativeSheet(true);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  }
  expect(router.push).not.toHaveBeenCalled();
});

test.each([
  ['OWNER', 'Nuevo turno', '/appointments/new'],
  ['OWNER', 'Nuevo cliente', '/clients/new'],
  ['OWNER', 'Nueva venta', '/sales/new'],
  ['OWNER', 'Nuevo gasto', '/expenses/new'],
  ['OWNER', 'Ingresar mercadería', '/purchases/new'],
  ['BARBER', 'Nuevo turno', '/appointments/new'],
  ['BARBER', 'Nuevo cliente', '/clients/new'],
] as const)(
  'desktop %s %s dispatches the unchanged route exactly once',
  async (role, label, route) => {
    agendaContext({ role });
    await resize(1280);
    await render(<NavigationTabs />);
    await fireEvent.press(screen.getByRole('button', { name: 'Acciones rápidas' }));
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(route);
    expectNativeSheet(false);
  },
);
