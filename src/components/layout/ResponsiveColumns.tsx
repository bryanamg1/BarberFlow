import { Children } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { theme } from '@/theme';

import { useWideLayout } from './useWideLayout';

// Stable row-major pairs preserve child identity and focus when the width changes.
export function ResponsiveColumns({ children, style, ...props }: ViewProps) {
  const wide = useWideLayout();
  const items = Children.toArray(children);
  return (
    <View {...props} style={[styles.gap, style]}>
      {items
        .filter((_, index) => index % 2 === 0)
        .map((item, row) => (
          <View key={row} style={[styles.gap, { flexDirection: wide ? 'row' : 'column' }]}>
            {[item, items[row * 2 + 1]].map((child, column) =>
              child === undefined ? null : (
                <View key={column} style={[styles.cell, wide && styles.wideCell]}>
                  {child}
                </View>
              ),
            )}
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: theme.spacing[16], minWidth: 0 },
  cell: { minWidth: 0 },
  wideCell: { flex: 1 },
});
