import { Tabs, usePathname } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/theme';
import { useAppointmentLifecycle } from '@/features/appointments/hooks/useAppointmentLifecycle';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { CenterQuickActionButton } from './CenterQuickActionButton';
import { SettingsEntry } from './SettingsEntry';

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
  const [quickActions, setQuickActions] = useState<{ epoch: symbol; open: boolean } | null>(null);
  const [selectionInFlight] = useState<symbol | null>(null);
  // A new route/context lifetime is closed immediately, without an effect reset
  // or reviving an earlier lifetime when the same route is revisited.
  const quickActionsOpen = quickActions?.epoch === lifetime.epoch ? quickActions.open : false;
  const selecting = selectionInFlight === lifetime.epoch;

  const toggleQuickActions = () => {
    if (validContext && lifetime.isCurrent() && !selecting)
      setQuickActions((current) => ({
        epoch: lifetime.epoch,
        open: !(current?.epoch === lifetime.epoch && current.open),
      }));
  };

  return (
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
              <View accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
                <SymbolView name={icon} tintColor={color} size={size} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
