import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { theme } from '@/theme';

import { useBusiness } from '../context/BusinessContext';

export function SettingsScreen() {
  const business = useBusiness();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Configuración
        </Text>
        <Card style={styles.section}>
          <Text role="heading" style={styles.sectionHeading}>
            Perfil
          </Text>
          <Text style={styles.description}>La edición del perfil todavía no está disponible.</Text>
        </Card>

        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : business.status === 'idle' ? (
          <EmptyState title="Negocio no disponible" />
        ) : (
          <View style={styles.section}>
            {business.data.role === 'OWNER' ? (
              <>
                <Card style={styles.section}>
                  <Text role="heading" style={styles.sectionHeading}>
                    Negocio
                  </Text>
                  <Button
                    label="Configuración del negocio"
                    variant="secondary"
                    onPress={() => router.push('/business/settings')}
                  />
                  <Button
                    label="Categorías de gastos"
                    variant="secondary"
                    onPress={() => router.push('/expenses/categories')}
                  />
                </Card>
                <Card style={styles.section}>
                  <Text role="heading" style={styles.sectionHeading}>
                    Horarios
                  </Text>
                  <Button
                    label="Horarios de atención"
                    variant="secondary"
                    onPress={() => router.push('/business/hours')}
                  />
                </Card>
              </>
            ) : (
              <Card style={styles.section}>
                <Text role="heading" style={styles.sectionHeading}>
                  Negocio y horarios
                </Text>
                <Text style={styles.description}>
                  Solo un OWNER puede administrar el negocio, sus horarios y las categorías de
                  gastos.
                </Text>
              </Card>
            )}
            <Button
              label="Servicios"
              variant="secondary"
              onPress={() => router.push('/services')}
            />
          </View>
        )}

        <Card style={styles.section}>
          <Text role="heading" style={styles.sectionHeading}>
            Medios de pago
          </Text>
          <Text style={styles.description}>
            Cinco medios de pago fijos en V1, sin personalización.
          </Text>
          {business.status === 'success' && (
            <Button
              label="Ver medios de pago"
              variant="secondary"
              onPress={() => router.push('/settings/payment-methods')}
            />
          )}
        </Card>
        <Card style={styles.section}>
          <Text role="heading" style={styles.sectionHeading}>
            Notificaciones
          </Text>
          <Text style={styles.description}>Preferencia de avisos de stock bajo del negocio.</Text>
          {business.status === 'success' && business.data.role === 'OWNER' && (
            <Button
              label="Configurar notificaciones"
              variant="secondary"
              onPress={() => router.push('/settings/notifications')}
            />
          )}
        </Card>
        <Card style={styles.section}>
          <Text role="heading" style={styles.sectionHeading}>
            Apariencia
          </Text>
          <Text style={styles.description}>Tema oscuro.</Text>
          {business.status === 'success' && (
            <Button
              label="Ver apariencia"
              variant="secondary"
              onPress={() => router.push('/settings/appearance')}
            />
          )}
        </Card>
        <LogoutButton />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[24] },
  section: { gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  sectionHeading: { ...theme.typography.headingSm, color: theme.colors.textPrimary },
  description: { ...theme.typography.body, color: theme.colors.textSecondary },
});
