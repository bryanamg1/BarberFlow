import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewProps,
} from 'react-native';

import { theme } from '@/theme';

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';

export type BadgeProps = Omit<ViewProps, 'children'> & {
  label: string;
  tone?: BadgeTone;
  textStyle?: StyleProp<TextStyle>;
};

const { colors } = theme;
const tones = {
  neutral: { background: colors.surfaceStrong, foreground: colors.textSecondary },
  primary: { background: colors.primaryMuted, foreground: colors.primary },
  accent: { background: colors.accentMuted, foreground: colors.accent },
  success: { background: colors.surface, foreground: colors.success },
  warning: { background: colors.surface, foreground: colors.warning },
  danger: { background: colors.surface, foreground: colors.danger },
} as const;

export function Badge({ label, tone = 'neutral', style, textStyle, ...props }: BadgeProps) {
  const palette = tones[tone];

  return (
    <View
      {...props}
      style={[
        styles.badge,
        { backgroundColor: palette.background, borderColor: palette.foreground },
        style,
      ]}
    >
      <Text style={[styles.label, { color: palette.foreground }, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    borderWidth: theme.borderWidths.thin,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[4],
  },
  label: { ...theme.typography.caption },
});
