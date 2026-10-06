import { useId, useState, type ReactNode, type Ref } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { theme } from '@/theme';

type InputName =
  | { label: string; accessibilityLabel?: string }
  | { label?: undefined; accessibilityLabel: string };

export type InputProps = Omit<TextInputProps, 'children' | 'aria-label'> &
  InputName & {
    error?: string;
    helperText?: string;
    disabled?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
    trailingAccessory?: ReactNode;
    ref?: Ref<TextInput>;
    'aria-describedby'?: string;
  };

export function Input({
  label,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  error,
  helperText,
  disabled = false,
  editable = true,
  readOnly = false,
  value,
  defaultValue,
  onChange,
  onChangeText,
  onFocus,
  onBlur,
  id,
  nativeID,
  'aria-describedby': describedBy,
  'aria-labelledby': labelledBy,
  placeholderTextColor = theme.colors.textSecondary,
  style,
  containerStyle,
  trailingAccessory,
  ref,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? nativeID ?? generatedId;
  const [focused, setFocused] = useState(false);
  const [localValue, setLocalValue] = useState(defaultValue ?? '');
  const canEdit = !disabled && editable && !readOnly;
  const filled = (value ?? localValue).length > 0;
  const message = error ? `Error: ${error}` : helperText;
  const messageId = `${inputId}-message`;
  const hint = [accessibilityHint, message].filter(Boolean).join('. ') || undefined;
  const borderColor = disabled
    ? theme.colors.border
    : error
      ? theme.semanticColors.input.errorBorder
      : focused
        ? theme.semanticColors.input.focusedBorder
        : filled
          ? theme.colors.borderStrong
          : theme.colors.border;
  // These DOM-only props are absent from native TextInput's type and native bridge.
  const webProps = Platform.select({
    web: {
      disabled,
      'aria-invalid': Boolean(error),
      'aria-describedby':
        [describedBy, message && messageId].filter(Boolean).join(' ') || undefined,
    },
    default: {},
  });

  return (
    <View style={[styles.container, containerStyle]}>
      {label !== undefined && (
        <Text id={`${inputId}-label`} style={styles.label}>
          {label}
        </Text>
      )}
      <View style={[styles.field, { borderColor }, disabled && styles.disabled]}>
        <TextInput
          {...props}
          {...webProps}
          ref={ref}
          id={inputId}
          accessible
          aria-label={accessibilityLabel ?? label}
          aria-labelledby={
            labelledBy ?? (label && !accessibilityLabel ? `${inputId}-label` : undefined)
          }
          accessibilityHint={hint}
          accessibilityState={{ ...accessibilityState, disabled }}
          aria-disabled={disabled}
          editable={canEdit}
          readOnly={!canEdit}
          value={value}
          defaultValue={defaultValue}
          placeholderTextColor={disabled ? theme.colors.textMuted : placeholderTextColor}
          selectionColor={theme.colors.primary}
          underlineColorAndroid={disabled ? theme.colors.surfaceStrong : theme.colors.surfaceRaised}
          onChange={canEdit ? onChange : undefined}
          onChangeText={(text) => {
            if (!canEdit) return;
            if (value === undefined) setLocalValue(text);
            onChangeText?.(text);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, disabled && styles.disabledText, style, styles.touchTarget]}
        />
        {trailingAccessory}
      </View>
      {message && (
        <Text id={messageId} aria-live="polite" style={[styles.message, error && styles.error]}>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing[8] },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    borderWidth: theme.borderWidths.thin,
    borderRadius: theme.radius.input,
  },
  input: {
    ...theme.typography.bodyLg,
    color: theme.colors.textPrimary,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[12],
    ...Platform.select({ web: { outlineColor: theme.colors.primary } }),
  },
  touchTarget: { minHeight: theme.sizing.touchTarget },
  disabled: { backgroundColor: theme.colors.surfaceStrong },
  disabledText: { color: theme.colors.textMuted },
  message: { ...theme.typography.caption, color: theme.colors.textSecondary },
  error: { color: theme.colors.danger },
});
