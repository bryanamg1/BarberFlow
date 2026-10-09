import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { theme } from '@/theme';

export default function SettingsScreen() {
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <Text style={styles.title}>Configuración</Text>
      <LogoutButton />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing[24],
    gap: theme.spacing[16],
    backgroundColor: theme.colors.background,
  },
  title: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
