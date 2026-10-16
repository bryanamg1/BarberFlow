import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { StockAdjustmentForm } from '../components/StockAdjustmentForm';
import { inventoryUuidSchema } from '../schemas/stockAdjustment.schema';

export function StockAdjustmentScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const business = useBusiness();
  const auth = useAuth();
  const height = useHeaderHeight();
  const productId = typeof id === 'string' && inventoryUuidSchema.safeParse(id).success ? id : null;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
        keyboardVerticalOffset={height}
        style={styles.fill}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <Text role="heading" style={styles.heading}>
            Ajustar stock
          </Text>
          {auth.status !== 'authenticated' ? (
            <EmptyState title="Sesión no disponible" />
          ) : business.status === 'pending' ? (
            <LoadingState message="Cargando negocio…" />
          ) : business.status === 'error' ? (
            <ErrorState message={business.error.message} />
          ) : business.status !== 'success' ? (
            <EmptyState title="Negocio no disponible" />
          ) : business.data.role !== 'OWNER' ? (
            <EmptyState title="Acceso restringido" message="Solo un OWNER puede ajustar stock." />
          ) : productId === null ? (
            <EmptyState title="Producto no disponible" />
          ) : (
            <StockAdjustmentForm
              key={JSON.stringify([
                auth.user.id,
                business.data.business.id,
                business.data.membershipId,
                productId,
              ])}
              businessId={business.data.business.id}
              productId={productId}
              onCancel={() => router.dismissTo('/products')}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  content: { padding: theme.spacing[16], gap: theme.spacing[24] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
