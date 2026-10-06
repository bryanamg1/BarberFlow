import { StyleSheet, View, type ViewProps } from 'react-native';

import { theme } from '@/theme';

export type CardProps = ViewProps;

export function Card({ children, style, ...props }: CardProps) {
  return (
    <View {...props} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surfaceRaised,
    borderColor: theme.colors.border,
    borderWidth: theme.borderWidths.thin,
    borderRadius: theme.radius.card,
    padding: theme.spacing[16],
    ...theme.shadows.raised,
  },
});
