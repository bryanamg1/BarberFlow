import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '@/theme';

import { Button } from './Button';

export type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  retryDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ErrorState({
  title = 'Ocurrió un error',
  message,
  onRetry,
  retryLabel = 'Reintentar',
  retrying = false,
  retryDisabled = false,
  style,
  testID,
}: ErrorStateProps) {
  return (
    <View testID={testID} style={[styles.container, style]}>
      <View
        accessible
        role="alert"
        aria-live="assertive"
        aria-label={[title, message].filter(Boolean).join('. ')}
        style={styles.content}
      >
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
      {onRetry && (
        <Button label={retryLabel} onPress={onRetry} loading={retrying} disabled={retryDisabled} />
      )}
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
  title: { ...theme.typography.headingLg, color: theme.colors.danger, textAlign: 'center' },
  message: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center' },
});
