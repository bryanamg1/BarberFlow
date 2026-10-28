import { fireEvent, screen } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TabsRoute from '@/app/(app)/(tabs)/_layout';
import HomeRoute from '@/app/(app)/(tabs)/index';
import AgendaRoute from '@/app/(app)/(tabs)/agenda';
import QuickActionRoute from '@/app/(app)/(tabs)/quick-action';
import FinanceRoute from '@/app/(app)/(tabs)/finances';
import SettingsRoute from '@/app/(app)/settings';
import { SettingsScreen } from '@/features/business/screens/SettingsScreen';
import { NavigationTabs } from '@/features/navigation/components/NavigationTabs';
import { SettingsEntry } from '@/features/navigation/components/SettingsEntry';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';
import { theme } from '@/theme';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { AgendaScreen } from '@/features/appointments/screens/AgendaScreen';

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
  router:
    jest.requireActual<typeof import('@/test/routerTestUtils')>('@/test/routerTestUtils')
      .routerMock,
  Tabs: Object.assign(
    jest.fn(() => null),
    { Screen: jest.fn(() => null) },
  ),
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { listByRange: jest.fn() },
}));
jest.mock('@/features/analytics/services/analyticsService', () => ({
  analyticsService: {
    getDashboardSummary: jest.fn(),
    getRevenueByDay: jest.fn(),
    getExpenseSummary: jest.fn(),
    getTopServices: jest.fn(),
    getTopProducts: jest.fn(),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: jest.fn(),
}));
jest.mock('@/features/analytics/components/HomeLowStock', () => ({ HomeLowStock: () => null }));
const insets = jest.mocked(useSafeAreaInsets);
beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  insets.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  jest
    .mocked(useBusiness)
    .mockReturnValue({ status: 'pending', data: null, error: null, isFetching: true });
});
test('BF280 route adapters expose the actual navigation and protected Settings screens', () => {
  expect(TabsRoute).toBe(NavigationTabs);
  expect(SettingsRoute).toBe(SettingsScreen);
  expect(AgendaRoute).toBe(AgendaScreen);
});
test.each([
  ['Inicio', HomeRoute],
  ['Agenda', AgendaRoute],
  ['Quick Action', QuickActionRoute],
  ['Finanzas', FinanceRoute],
] as const)(
  'BF280 existing %s destination remains legible on the dark scene',
  async (label, Route) => {
    await renderWithProviders(<Route />);
    expect(screen.getByText(label)).toHaveStyle({
      color: theme.colors.textPrimary,
      ...(label === 'Inicio' || label === 'Finanzas'
        ? theme.typography.headingLg
        : label === 'Agenda'
          ? theme.typography.heading
          : theme.typography.body),
    });
  },
);
test('BF280 accessible Settings header entry navigates once without Auth operations', async () => {
  await renderWithProviders(<SettingsEntry />);
  const button = screen.getByRole('button', { name: 'Configuración' });
  expect(button).toHaveStyle({
    minWidth: theme.sizing.touchTarget,
    minHeight: theme.sizing.touchTarget,
  });
  await fireEvent.press(button);
  expect(routerMock.push).toHaveBeenCalledTimes(1);
  expect(routerMock.push).toHaveBeenCalledWith('/settings');
  expect(routerMock.replace).not.toHaveBeenCalled();
});
test('BF280 Settings entry has visible focus using existing tokens', async () => {
  await renderWithProviders(<SettingsEntry />);
  await fireEvent(screen.getByRole('button', { name: 'Configuración' }), 'focus', {});
  expect(screen.getByRole('button', { name: 'Configuración' })).toHaveStyle({
    borderColor: theme.colors.primary,
    borderWidth: theme.borderWidths.thin,
  });
});
test.each([0, 34])(
  'BF280 keeps native safe-area bottom %s in the default Router tab bar',
  async (bottom) => {
    insets.mockReturnValue({ top: 0, left: 0, right: 0, bottom });
    await renderWithProviders(<NavigationTabs />);
    const tabs = jest.requireMock<{ Tabs: jest.Mock }>('expo-router').Tabs.mock.calls[0][0];
    expect(tabs.initialRouteName).toBe('index');
    expect(tabs.screenOptions.tabBarStyle.height).toBe(
      theme.sizing.touchTarget + theme.spacing[32] + bottom,
    );
    expect(tabs.screenOptions.tabBarActiveTintColor).toBe(theme.semanticColors.navigation.active);
    expect(tabs.screenOptions.tabBarInactiveTintColor).toBe(
      theme.semanticColors.navigation.inactive,
    );
    expect(tabs.screenOptions.tabBarLabelStyle).toEqual({
      ...theme.typography.caption,
      fontWeight: theme.fontWeights.regular,
    });
    expect(tabs.screenOptions.tabBarItemStyle.minHeight).toBe(theme.sizing.touchTarget);
    expect(tabs.screenOptions.tabBarButton).toBeUndefined();
    expect(tabs.screenOptions.tabBarBadge).toBeUndefined();
    expect(tabs.screenOptions.tabBarPosition).toBeUndefined();
    expect(tabs.children.map((c: React.ReactElement<{ name: string }>) => c.props.name)).toEqual([
      'index',
      'agenda',
      'quick-action',
      'clients',
      'finances',
    ]);
  },
);
