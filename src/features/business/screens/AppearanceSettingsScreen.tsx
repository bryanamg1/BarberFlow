import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';

import { useBusiness } from '../context/BusinessContext';

export function AppearanceSettingsScreen() {
  const business = useBusiness();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Apariencia
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : business.status === 'idle' ? (
          <EmptyState title="Negocio no disponible" />
        ) : (
          <Card style={styles.section}>
            <Text role="heading" style={styles.sectionHeading}>
              Tema oscuro
            </Text>
            <Text style={styles.description}>
              BarberFlow utiliza un tema oscuro fijo, con tipografía Inter. La apariencia es la
              misma para todos los negocios y dispositivos.
            </Text>
            <Text style={styles.description}>
              No hay opciones de tema claro, automático ni de personalización de colores en V1.
            </Text>
          </Card>
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
  section: { gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  sectionHeading: { ...theme.typography.headingSm, color: theme.colors.textPrimary },
  description: { ...theme.typography.body, color: theme.colors.textSecondary },
});
