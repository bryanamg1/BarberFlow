import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { inventoryKeys } from '../constants/inventoryKeys';
import { useStockMovements } from '../hooks/useStockMovements';
import type { StockMovementRow, StockMovementType } from '../types/inventory.types';
import type { StockMovementFilters } from '../types/stockMovementHistory.types';
import { normalizeStockMovementParams } from '../utils/stockMovementParams';

export type StockMovementHistoryProps = {
  productId: string | null;
  filters?: StockMovementFilters;
};
const labels: Record<StockMovementType, string> = {
  PURCHASE: 'Compra',
  SALE: 'Venta',
  LOSS: 'Pérdida',
  ADJUSTMENT: 'Ajuste',
  RETURN: 'Devolución',
};

// Composable history only: routing and filter controls belong to its future consumer.
export function StockMovementHistory({ productId, filters = {} }: StockMovementHistoryProps) {
  const business = useBusiness();
  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error') return <ErrorState message={business.error.message} />;
  if (business.status !== 'success') return <EmptyState title="Negocio no disponible" />;
  return (
    <History
      key={JSON.stringify([
        business.data.business.id,
        productId,
        filters.type,
        filters.from,
        filters.to,
      ])}
      productId={productId}
      filters={filters}
      businessId={business.data.business.id}
      currency={business.data.business.currency_code}
      timezone={business.data.business.timezone}
    />
  );
}

function History({
  productId,
  filters,
  businessId,
  currency,
  timezone,
}: StockMovementHistoryProps & {
  filters: StockMovementFilters;
  businessId: string;
  currency: string;
  timezone: string;
}) {
  const [page, setPage] = useState(1);
  const result = useStockMovements(productId, page, 25, filters);
  const client = useQueryClient();
  const params = normalizeStockMovementParams({ ...filters, page, pageSize: 25 });
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Historial de stock
      </Text>
      {result.status === 'pending' ? (
        <LoadingState message="Cargando movimientos…" />
      ) : result.status === 'idle' ? (
        <EmptyState title="Selecciona un producto" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={
            params && productId
              ? () => {
                  void client.invalidateQueries({
                    queryKey: inventoryKeys.stockMovements(businessId, productId, params),
                    exact: true,
                  });
                }
              : undefined
          }
        />
      ) : (
        <>
          {result.data.items.length === 0 ? (
            <EmptyState title="No hay movimientos de stock." />
          ) : (
            result.data.items.map((item) => (
              <Movement key={item.id} item={item} currency={currency} timezone={timezone} />
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1}
              onPress={() => {
                if (page > 1) setPage(page - 1);
              }}
            />
            <Text role="status" aria-live="polite" style={styles.secondary}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage}
              onPress={() => {
                if (result.data.hasNextPage) setPage(page + 1);
              }}
            />
          </View>
        </>
      )}
    </View>
  );
}

function displayInstant(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return value;
  } // Retain the explicit original instant if display configuration is invalid.
}

function Movement({
  item,
  currency,
  timezone,
}: {
  item: StockMovementRow;
  currency: string;
  timezone: string;
}) {
  const quantity =
    item.quantity_delta > 0 ? `+${item.quantity_delta}` : String(item.quantity_delta);
  return (
    <Card>
      <View style={styles.section}>
        <Text style={styles.heading}>{labels[item.type]}</Text>
        <Text
          accessibilityLabel={`Cantidad ${quantity}`}
          style={[
            styles.quantity,
            {
              color:
                item.quantity_delta > 0
                  ? theme.colors.success
                  : item.quantity_delta < 0
                    ? theme.colors.danger
                    : theme.colors.textPrimary,
            },
          ]}
        >
          {quantity}
        </Text>
        <Text style={styles.secondary}>
          {displayInstant(item.occurred_at, timezone)} · {timezone}
        </Text>
        {item.unit_cost !== null && (
          <Text style={styles.secondary}>
            Costo unitario: {formatCatalogPrice(item.unit_cost, currency)}
          </Text>
        )}
        {item.reference_type !== null && (
          <Text style={styles.secondary}>Referencia: {item.reference_type}</Text>
        )}
        {item.reference_id !== null && (
          <Text style={styles.secondary}>ID de referencia: {item.reference_id}</Text>
        )}
        {item.notes !== null && <Text style={styles.secondary}>Notas: {item.notes}</Text>}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  heading: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
  secondary: { ...theme.typography.body, color: theme.colors.textSecondary },
  quantity: { ...theme.typography.heading },
});
