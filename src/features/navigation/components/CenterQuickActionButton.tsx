import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { IconButton } from '@/components/ui';
import { theme } from '@/theme';

export type CenterQuickActionButtonProps = {
  open: boolean;
  onPress: () => void;
  disabled?: boolean;
};

export function CenterQuickActionButton({
  open,
  onPress,
  disabled = false,
}: CenterQuickActionButtonProps) {
  return (
    <IconButton
      accessibilityLabel="Acciones rápidas"
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: disabled
            ? theme.colors.surfaceStrong
            : open || pressed
              ? theme.colors.primaryPressed
              : theme.colors.primary,
        },
      ]}
      icon={({ color, size }) => (
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          tintColor={disabled ? color : theme.colors.background}
          size={size}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: theme.sizing.fab,
    height: theme.sizing.fab,
    borderRadius: theme.radius.pill,
  },
});
