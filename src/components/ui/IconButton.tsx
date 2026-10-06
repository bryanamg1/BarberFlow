import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { theme } from '@/theme';

export type IconButtonProps = Omit<
  PressableProps,
  'children' | 'disabled' | 'role' | 'accessibilityRole' | 'aria-label' | 'aria-disabled'
> & {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: (props: { color: string; size: number }) => ReactNode;
};

const { colors, spacing, radius, sizing, borderWidths } = theme;

export function IconButton({
  icon,
  accessibilityLabel,
  disabled = false,
  accessibilityState,
  onFocus,
  onBlur,
  onPress,
  style,
  ...props
}: IconButtonProps) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      {...props}
      accessible
      role="button"
      aria-label={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled }}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
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
        state.pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
        focused && !disabled && styles.focused,
        styles.touchTarget,
      ]}
    >
      {({ pressed }) => (
        <View accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
          {icon({
            color: disabled ? colors.textMuted : pressed ? colors.primary : colors.textPrimary,
            size: spacing[24],
          })}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    padding: spacing[8],
  },
  touchTarget: { minHeight: sizing.touchTarget, minWidth: sizing.touchTarget },
  pressed: { backgroundColor: colors.primaryMuted },
  disabled: { backgroundColor: colors.surfaceStrong },
  focused: {
    borderWidth: borderWidths.thin,
    borderColor: colors.primary,
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
