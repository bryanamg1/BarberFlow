import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';

import { useBusiness } from '../context/BusinessContext';

// Presentation of the fixed HD-006 contract; these are not configurable settings.
const methods = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  DIGITAL_WALLET: 'Billetera digital / QR',
} as const;

export function PaymentMethodSettingsScreen() {
  const business = useBusiness();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Medios de pago
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : business.status === 'idle' ? (
          <EmptyState title="Negocio no disponible" />
        ) : (
          <>
            <Text style={styles.description}>
              Estos cinco medios son fijos en V1. No se pueden activar, desactivar ni personalizar.
            </Text>
            {Object.entries(methods).map(([code, label]) => (
              <Card key={code}>
                <Text style={styles.method}>{label}</Text>
              </Card>
            ))}
            <Text style={styles.description}>
              BarberFlow solo registra el medio de pago. No procesa cobros, inicia transferencias ni
              se conecta con proveedores de tarjetas o billeteras.
            </Text>
          </>
        )}
        <Button
          label="Volver a Configuración"
          variant="secondary"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/settings');
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  method: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
  description: { ...theme.typography.body, color: theme.colors.textSecondary },
});
