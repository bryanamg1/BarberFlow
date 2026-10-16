import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { IconButton } from '@/components/ui';

export function SettingsEntry() {
  return (
    <IconButton
      accessibilityLabel="Configuración"
      onPress={() => router.push('/settings')}
      icon={({ color, size }) => (
        <SymbolView
          name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
          tintColor={color}
          size={size}
        />
      )}
    />
  );
}
