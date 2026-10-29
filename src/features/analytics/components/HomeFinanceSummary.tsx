import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';
import type { HomeDashboardSummaryResult } from '../types/home.types';

export type HomeFinanceSummaryProps = {
  result: HomeDashboardSummaryResult;
  onOpenFinances: () => void;
};

export function HomeFinanceSummary({ result, onOpenFinances }: HomeFinanceSummaryProps) {
  const auth = useAuth();
  const business = useBusiness();
  const { width } = useWindowDimensions();
  if (
    auth.status !== 'authenticated' ||
    business.status !== 'success' ||
    business.isFetching ||
    business.data.role !== 'OWNER'
  )
    return null;
  if (result.status === 'loading') return <LoadingState message="Cargando resumen financiero…" />;
  if (result.status === 'error')
    return <ErrorState message="No pudimos cargar el resumen financiero." />;
  const unavailable = <EmptyState title="Resumen financiero no disponible" />;
  if (result.status !== 'success') return unavailable;
  const currency = business.data.business.currency_code;
  const revenue = formatMoney(result.data.total_revenue, currency);
  const profit = formatMoney(result.data.profit, currency);
  if (revenue === 'Importe no disponible' || profit === 'Importe no disponible') return unavailable;
  return (
    <Card style={styles.card}>
      <Text role="heading" style={styles.heading}>
        Resumen financiero
      </Text>
      <View style={[styles.values, width >= 768 && styles.wide]}>
        {[
          ['Ingresos', revenue],
          ['Ganancia', profit],
        ].map(([label, value]) => (
          <View
            key={label}
            accessible
            role="group"
            accessibilityLabel={`${label}: ${value}`}
            style={styles.valueGroup}
          >
            <Text accessible={false} aria-hidden style={styles.label}>
              {label}
            </Text>
            <Text accessible={false} aria-hidden style={styles.value}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      <Button label="Ver finanzas" onPress={() => onOpenFinances()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: theme.spacing[16] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  values: { gap: theme.spacing[16] },
  wide: { flexDirection: 'row', flexWrap: 'wrap' },
  valueGroup: { minWidth: 0, flexShrink: 1, gap: theme.spacing[8] },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textSecondary },
  value: { ...theme.typography.headingLg, color: theme.colors.textPrimary, flexShrink: 1 },
});
