import { StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';
import type { UseLowStockAlertsResult } from '../types/lowStockAlerts.types';

// Presentation only: the hook owns preference/queries, and BF221 owns stock/filtering.
export function LowStockAlertList({
  result,
  onPrevious,
  onNext,
}: {
  result: UseLowStockAlertsResult;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (result.status === 'idle') return <EmptyState title="Negocio no disponible" />;
  if (result.status === 'pending') return <LoadingState message="Cargando avisos de stock…" />;
  if (result.status === 'disabled') return <EmptyState title="Avisos de stock desactivados" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message={result.error.message}
        retrying={result.isFetching}
        onRetry={() => {
          void result.retry();
        }}
      />
    );
  return (
    <View style={styles.section}>
      {result.data.items.length === 0 ? (
        <EmptyState title="No hay productos con stock bajo" />
      ) : (
        result.data.items.map((item) => (
          <Card key={item.product_id} style={styles.section}>
            <Text style={styles.name}>{item.name}</Text>
            <Badge
              label={`Stock: ${item.current_stock}`}
              tone={item.current_stock === '0' ? 'danger' : 'warning'}
            />
            {item.current_stock === '0' && <Text style={styles.body}>Sin stock</Text>}
            <Text style={styles.body}>Mínimo: {item.minimum_stock}</Text>
          </Card>
        ))
      )}
      <View style={styles.controls}>
        <Button
          label="Anterior"
          variant="secondary"
          disabled={result.data.page <= 1}
          onPress={onPrevious}
        />
        <Text role="status" style={styles.body}>
          Página {result.data.page}
        </Text>
        <Button
          label="Siguiente"
          variant="secondary"
          disabled={!result.data.hasNextPage}
          onPress={onNext}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  name: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
  body: { ...theme.typography.body, color: theme.colors.textSecondary },
});
