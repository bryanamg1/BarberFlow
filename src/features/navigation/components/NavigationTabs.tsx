import { router, Tabs, usePathname, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/theme';
import { useAppointmentLifecycle } from '@/features/appointments/hooks/useAppointmentLifecycle';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { CenterQuickActionButton } from './CenterQuickActionButton';
import { QuickActionSheet } from './QuickActionSheet';
import { SettingsEntry } from './SettingsEntry';
import { isQuickActionAllowed, type QuickActionId } from '../quickActions';

const quickActionRoutes = {
  NEW_APPOINTMENT: '/appointments/new',
  NEW_CLIENT: '/clients/new',
  NEW_SALE: '/sales/new',
  NEW_EXPENSE: '/expenses/new',
  NEW_PURCHASE: '/purchases/new',
} as const satisfies Record<QuickActionId, Href>;

type QuickActionIntent = { epoch: symbol; open: boolean; token: symbol | null };
type PendingAction = { epoch: symbol; action: QuickActionId };

const destinations = [
  { name: 'index', label: 'Inicio', icon: { ios: 'house', android: 'home', web: 'home' } },
  {
    name: 'agenda',
    label: 'Agenda',
    icon: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  },
  {
    name: 'quick-action',
    label: 'Quick Action',
    icon: { ios: 'plus', android: 'add', web: 'add' },
  },
  { name: 'clients', label: 'Clientes', icon: { ios: 'person.2', android: 'group', web: 'group' } },
  {
    name: 'finances',
    label: 'Finanzas',
    icon: { ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' },
  },
] as const;

export function NavigationTabs() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const business = useBusiness();
  const lifetime = useAppointmentLifecycle(
    JSON.stringify(['quick-actions', pathname, business.isFetching]),
  );
  const validContext = lifetime.scope !== null && !business.isFetching;
  const [quickActions, setQuickActions] = useState<QuickActionIntent | null>(null);
  const liveIntent = useRef<QuickActionIntent | null>(null);
  const [selectionInFlight, setSelectionInFlight] = useState<symbol | null>(null);
  const selectionLock = useRef<symbol | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const dispatched = useRef<PendingAction | null>(null);
  // A new route/context lifetime is closed immediately, without an effect reset
  // or reviving an earlier lifetime when the same route is revisited.
  const quickActionsOpen = quickActions?.epoch === lifetime.epoch ? quickActions.open : false;
  const selecting = selectionInFlight === lifetime.epoch;

  const changeIntent = (open: boolean) => {
    const intent = { epoch: lifetime.epoch, open, token: open ? Symbol() : null };
    liveIntent.current = intent;
    setQuickActions(intent);
  };

  const toggleQuickActions = () => {
    if (!validContext || !lifetime.isCurrent() || selectionLock.current === lifetime.epoch) return;
    const wasOpen = liveIntent.current?.epoch === lifetime.epoch && liveIntent.current.open;
    changeIntent(!wasOpen);
    setPendingAction(null);
  };

  const currentOpening = () =>
    validContext &&
    lifetime.isCurrent() &&
    quickActionsOpen &&
    liveIntent.current?.epoch === lifetime.epoch &&
    liveIntent.current.open &&
    liveIntent.current.token === quickActions?.token;

  const closeQuickActions = () => {
    if (currentOpening()) changeIntent(false);
  };

  const selectQuickAction = (action: QuickActionId) => {
    if (!currentOpening() || !lifetime.scope) return;
    if (!isQuickActionAllowed(action, lifetime.scope.role)) {
      changeIntent(false);
      return;
    }
    if (selectionLock.current === lifetime.epoch) return;
    selectionLock.current = lifetime.epoch;
    setSelectionInFlight(lifetime.epoch);
    changeIntent(false);
    setPendingAction({ epoch: lifetime.epoch, action });
  };

  useEffect(() => {
    if (
      !pendingAction ||
      pendingAction.epoch !== lifetime.epoch ||
      quickActionsOpen ||
      !validContext
    )
      return;
    // Run after the closed commit and the modal's passive focus/portal cleanup.
    // A queued task must still belong to this mounted route/context lifetime.
    queueMicrotask(() => {
      if (!lifetime.isCurrent() || dispatched.current === pendingAction || !lifetime.scope) return;
      dispatched.current = pendingAction;
      if (!isQuickActionAllowed(pendingAction.action, lifetime.scope.role)) return;
      try {
        router.push(quickActionRoutes[pendingAction.action]);
      } catch {
        // Local navigation failure is not a domain error or a reason to replay.
        selectionLock.current = null;
        setSelectionInFlight(null);
      }
    });
  }, [pendingAction, quickActionsOpen, validContext, lifetime]);

  return (
    <>
      <Tabs
        initialRouteName="index"
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.textPrimary,
          headerTitleStyle: theme.typography.headingSm,
          headerRight: () => <SettingsEntry />,
          sceneStyle: { backgroundColor: theme.colors.background },
          tabBarActiveTintColor: theme.semanticColors.navigation.active,
          tabBarInactiveTintColor: theme.semanticColors.navigation.inactive,
          tabBarLabelStyle: { ...theme.typography.caption, fontWeight: theme.fontWeights.regular },
          tabBarLabelPosition: 'below-icon',
          tabBarItemStyle: {
            minHeight: theme.sizing.touchTarget,
          },
          tabBarStyle: {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            borderTopWidth: theme.borderWidths.thin,
            height: theme.sizing.touchTarget + theme.spacing[32] + insets.bottom,
          },
        }}
      >
        {destinations.map(({ name, label, icon }) => (
          <Tabs.Screen
            key={name}
            name={name}
            listeners={
              name === 'quick-action' ? { tabPress: (event) => event.preventDefault() } : undefined
            }
            options={{
              title: label,
              tabBarAccessibilityLabel: label,
              // Keep the legacy file registered, but never invoke its tab action or expose a link.
              ...(name === 'quick-action' && {
                tabBarButton: () =>
                  validContext ? (
                    <CenterQuickActionButton
                      open={quickActionsOpen}
                      disabled={selecting}
                      onPress={toggleQuickActions}
                    />
                  ) : null,
              }),
              tabBarLabel: ({ color }) => (
                <Text
                  style={{
                    ...theme.typography.caption,
                    fontWeight: theme.fontWeights.regular,
                    color,
                  }}
                >
                  {label}
                </Text>
              ),
              tabBarIcon: ({ color, size }) => (
                <View
                  accessible={false}
                  aria-hidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <SymbolView name={icon} tintColor={color} size={size} />
                </View>
              ),
            }}
          />
        ))}
      </Tabs>
      {validContext && lifetime.scope && (
        <QuickActionSheet
          visible={quickActionsOpen}
          role={lifetime.scope.role}
          onClose={closeQuickActions}
          onSelect={selectQuickAction}
        />
      )}
    </>
  );
}
