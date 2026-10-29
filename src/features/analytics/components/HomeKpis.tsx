import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';
import type { HomeDashboardSummaryResult } from '../types/home.types';

export type HomeKpisProps = { result: HomeDashboardSummaryResult };

export function HomeKpis({ result }: HomeKpisProps) {
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
  if (result.status === 'loading') return <LoadingState message="Cargando indicadores…" />;
  if (result.status === 'error') return <ErrorState message="No pudimos cargar los indicadores." />;
  const unavailable = <EmptyState title="Indicadores no disponibles" />;
  if (result.status !== 'success') return unavailable;
  const revenue = formatMoney(result.data.total_revenue, business.data.business.currency_code);
  if (revenue === 'Importe no disponible') return unavailable;
  const cards = [
    ['Ingresos de hoy', revenue],
    ['Turnos de hoy', result.data.appointments],
    ['Clientes activos', result.data.active_clients],
  ];
  return (
    <View style={[styles.container, width >= 768 && styles.wide]}>
      {cards.map(([label, value]) => (
        <Card
          key={label}
          role="group"
          accessible
          accessibilityLabel={`${label}: ${value}`}
          style={[styles.card, width >= 768 && styles.wideCard]}
        >
          <Text accessible={false} aria-hidden style={styles.label}>
            {label}
          </Text>
          <Text accessible={false} aria-hidden style={styles.value}>
            {value}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: theme.spacing[16] },
  wide: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { minWidth: 0, gap: theme.spacing[8] },
  wideCard: { flexBasis: '30%', flexGrow: 1, flexShrink: 1 },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textSecondary },
  value: { ...theme.typography.headingLg, color: theme.colors.textPrimary, flexShrink: 1 },
});
