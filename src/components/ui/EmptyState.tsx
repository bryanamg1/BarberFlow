import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '@/theme';

import { Button, type ButtonProps } from './Button';

export type EmptyStateProps = {
  title?: string;
  message?: string;
  action?: Pick<ButtonProps, 'label' | 'disabled' | 'loading' | 'accessibilityLabel'> & {
    onPress: NonNullable<ButtonProps['onPress']>;
  };
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function EmptyState({
  title = 'Sin resultados',
  message,
  action,
  style,
  testID,
}: EmptyStateProps) {
  return (
    <View testID={testID} style={[styles.container, style]}>
      <View
        accessible
        role="status"
        aria-live="polite"
        aria-label={[title, message].filter(Boolean).join('. ')}
        style={styles.content}
      >
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
      {action && <Button {...action} />}
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
  content: { alignSelf: 'stretch', gap: theme.spacing[8] },
  title: { ...theme.typography.heading, color: theme.colors.textPrimary, textAlign: 'center' },
  message: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center' },
});
