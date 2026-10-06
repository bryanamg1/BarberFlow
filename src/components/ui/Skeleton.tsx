import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { theme } from '@/theme';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: keyof typeof theme.radius;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Skeleton({
  width = '100%',
  height = theme.spacing[24],
  radius = 8,
  style,
  testID,
}: SkeletonProps) {
  return (
    <View
      testID={testID}
      role="presentation"
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height, borderRadius: theme.radius[radius] },
        style,
        styles.decorative,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: theme.colors.surfaceStrong },
  decorative: { pointerEvents: 'none' },
});
