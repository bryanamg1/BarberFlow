import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { theme } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

export type ButtonProps = Omit<
  PressableProps,
  | 'children'
  | 'disabled'
  | 'role'
  | 'accessibilityRole'
  | 'aria-label'
  | 'aria-disabled'
  | 'aria-busy'
> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  textStyle?: StyleProp<TextStyle>;
};

const { colors, borderWidths, spacing, radius, sizing, typography } = theme;
const variants = {
  primary: {
    background: colors.primary,
    pressedBackground: colors.primaryPressed,
    foreground: colors.background,
    pressedForeground: colors.background,
    border: colors.primary,
    pressedBorder: colors.primaryPressed,
  },
  secondary: {
    background: colors.surfaceRaised,
    pressedBackground: colors.surfaceStrong,
    foreground: colors.textPrimary,
    pressedForeground: colors.textPrimary,
    border: colors.border,
    pressedBorder: colors.borderStrong,
  },
  outline: {
    background: undefined,
    pressedBackground: colors.primaryMuted,
    foreground: colors.primary,
    pressedForeground: colors.primary,
    border: colors.primary,
    pressedBorder: colors.primary,
  },
  danger: {
    background: colors.danger,
    pressedBackground: colors.background,
    foreground: colors.background,
    pressedForeground: colors.danger,
    border: colors.danger,
    pressedBorder: colors.danger,
  },
  ghost: {
    background: undefined,
    pressedBackground: colors.surfaceStrong,
    foreground: colors.textPrimary,
    pressedForeground: colors.textPrimary,
    border: undefined,
    pressedBorder: undefined,
  },
} as const;

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel = label,
  accessibilityState,
  style,
  textStyle,
  onFocus,
  onBlur,
  onPress,
  ...props
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  const palette = variants[variant];

  return (
    <Pressable
      {...props}
      accessible
      role="button"
      aria-label={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled: blocked, busy: loading }}
      aria-disabled={blocked}
      aria-busy={loading}
      disabled={blocked}
      onPress={blocked ? undefined : onPress}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={(state) => [
        styles.button,
        {
          backgroundColor: disabled
            ? colors.surfaceStrong
            : state.pressed && !blocked
              ? palette.pressedBackground
              : palette.background,
          borderColor: disabled
            ? colors.border
            : state.pressed && !blocked
              ? palette.pressedBorder
              : palette.border,
          borderWidth: palette.border ? borderWidths.thin : undefined,
        },
        typeof style === 'function' ? style(state) : style,
        focused && !blocked && styles.focused,
        styles.touchTarget,
      ]}
    >
      {({ pressed }) => {
        const color = disabled
          ? colors.textMuted
          : pressed && !blocked
            ? palette.pressedForeground
            : palette.foreground;

        return (
          <>
            {loading && (
              <ActivityIndicator
                size="small"
                color={color}
                accessible={false}
                aria-hidden
                importantForAccessibility="no-hide-descendants"
              />
            )}
            <Text style={[styles.label, { color }, textStyle]}>{label}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
    borderRadius: radius.button,
  },
  touchTarget: { minHeight: sizing.touchTarget, minWidth: sizing.touchTarget },
  label: { ...typography.bodyMedium, textAlign: 'center', flexShrink: 1 },
  focused: {
    borderWidth: borderWidths.thin,
    borderColor: colors.textPrimary,
    ...Platform.select({
      web: {
        outlineStyle: 'solid',
        outlineColor: colors.primary,
        outlineWidth: borderWidths.thin,
        outlineOffset: spacing[4],
      },
    }),
  },
});
