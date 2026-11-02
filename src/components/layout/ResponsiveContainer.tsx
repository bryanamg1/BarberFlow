import { StyleSheet, View, type ViewProps } from 'react-native';

import { theme } from '@/theme';

import { useWideLayout } from './useWideLayout';

export function ResponsiveContainer({ style, ...props }: ViewProps) {
  const wide = useWideLayout();
  return (
    <View
      {...props}
      style={[
        styles.gutters,
        style,
        styles.bounds,
        { maxWidth: wide ? theme.layout.contentMaxWidth : undefined },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  gutters: { paddingHorizontal: theme.spacing[16] },
  bounds: { width: '100%', alignSelf: 'center', minWidth: 0 },
});
