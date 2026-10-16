import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';
import { ProfileSettingsForm } from '../components/ProfileSettingsForm';
import { useProfileSettings } from '../hooks/useProfileSettings';

export function ProfileSettingsScreen() {
  const controller = useProfileSettings();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Perfil y cuenta
        </Text>
        {!controller.available ? (
          <EmptyState title="Perfil no disponible" />
        ) : controller.query.isError ? (
          <ErrorState
            message={controller.query.error.message}
            onRetry={() => {
              void controller.query.refetch();
            }}
          />
        ) : !controller.query.isSuccess ? (
          <LoadingState message="Cargando perfil…" />
        ) : (
          <ProfileSettingsForm
            key={controller.query.data.id}
            profile={controller.query.data}
            controller={controller}
          />
        )}
        <Button
          label="Volver a Configuración"
          variant="secondary"
          onPress={() => router.dismissTo('/settings')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
