import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { theme } from '@/theme';

export type LoadingStateProps = {
  message?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function LoadingState({ message = 'Cargando…', style, testID }: LoadingStateProps) {
  return (
    <View
      testID={testID}
      accessible
      role="progressbar"
      aria-label={message || 'Cargando…'}
      aria-busy
      accessibilityState={{ busy: true }}
      style={[styles.container, style]}
    >
      <ActivityIndicator
        color={theme.colors.primary}
        size="large"
        accessible={false}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
      />
      {message !== '' && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[24],
    gap: theme.spacing[16],
  },
  message: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});
