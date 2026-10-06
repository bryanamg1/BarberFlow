import { StyleSheet, View, type ViewProps } from 'react-native';

import { theme } from '@/theme';

export type DividerProps = Omit<ViewProps, 'children'>;

export function Divider({ style, ...props }: DividerProps) {
  return (
    <View
      {...props}
      role="presentation"
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.divider, style]}
    />
  );
}

const styles = StyleSheet.create({
  divider: {
    alignSelf: 'stretch',
    borderBottomWidth: theme.borderWidths.thin,
    borderBottomColor: theme.colors.border,
  },
});
