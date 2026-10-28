import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';

import type { FinanceServicesResult } from '../types/finance.types';

export type FinanceServicesPanelProps = { result: FinanceServicesResult };

// BF256 supplies current-context results and owns queries, period and limit.
export function FinanceServicesPanel({ result }: FinanceServicesPanelProps) {
  const auth = useAuth();
  const business = useBusiness();
  const { width } = useWindowDimensions();
  const unavailable = <EmptyState title="Servicios financieros no disponibles" />;
  if (
    auth.status !== 'authenticated' ||
    business.status !== 'success' ||
    business.data.role !== 'OWNER' ||
    business.isFetching
  )
    return unavailable;
  if (result.status === 'loading') return <LoadingState message="Cargando servicios…" />;
  if (result.status === 'error') return <ErrorState message="No pudimos cargar los servicios." />;
  if (result.status !== 'success' || !Array.isArray(result.data)) return unavailable;

  const currency = business.data.business.currency_code;
  const identities = new Set<string>();
  const rows: { id: string; name: string; quantity: string; revenue: string }[] = [];
  for (const row of result.data) {
    if (
      !row ||
      typeof row.service_id !== 'string' ||
      !row.service_id.trim() ||
      identities.has(row.service_id) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      typeof row.quantity !== 'string' ||
      !/^\d+$/.test(row.quantity) ||
      typeof row.net_revenue !== 'string' ||
      !/^\d+\.\d{2}$/.test(row.net_revenue)
    )
      return unavailable;
    const revenue = formatMoney(row.net_revenue, currency);
    if (revenue === 'Importe no disponible') return unavailable;
    identities.add(row.service_id);
    rows.push({ id: row.service_id, name: row.name, quantity: row.quantity, revenue });
  }
  if (!rows.length) return <EmptyState title="Sin servicios con ventas en este período" />;
  const wide = width >= 768;

  return (
    <View style={styles.panel}>
      {rows.map((row) => (
        <Card
          key={row.id}
          role="group"
          accessible
          accessibilityLabel={`${row.name}. Cantidad: ${row.quantity}. Ingresos netos: ${row.revenue}`}
          style={[styles.row, wide && styles.wideRow]}
        >
          <View
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.cell, wide && styles.wideCell]}
          >
            <Text accessible={false} style={styles.label}>
              Servicio
            </Text>
            <Text accessible={false} style={styles.name}>
              {row.name}
            </Text>
          </View>
          <View
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.cell, wide && styles.wideCell]}
          >
            <Text accessible={false} style={styles.label}>
              Cantidad
            </Text>
            <Text accessible={false} style={styles.value}>
              {row.quantity}
            </Text>
          </View>
          <View
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.cell, wide && styles.wideCell]}
          >
            <Text accessible={false} style={styles.label}>
              Ingresos netos
            </Text>
            <Text accessible={false} style={styles.value}>
              {row.revenue}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing[12] },
  row: { gap: theme.spacing[16] },
  wideRow: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { minWidth: 0, gap: theme.spacing[4] },
  wideCell: { flex: 1 },
  label: { ...theme.typography.caption, color: theme.colors.textSecondary },
  name: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary, flexShrink: 1 },
  value: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
});
