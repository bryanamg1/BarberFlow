import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';

import type { FinanceDashboardSummary, FinanceKpiResult } from '../types/finance.types';
import type { FinancePeriod } from '../utils/financePeriod';

const metrics = [
  ['total_revenue', 'Ingresos totales', 'money'],
  ['service_revenue', 'Ingresos por servicios', 'money'],
  ['product_revenue', 'Ingresos por productos', 'money'],
  ['expenses', 'Gastos manuales', 'money'],
  ['merchandise_purchases', 'Compras de mercadería', 'money'],
  ['profit', 'Ganancia', 'money'],
  ['appointments', 'Turnos', 'count'],
  ['active_clients', 'Clientes activos', 'count'],
  ['average_ticket', 'Ticket promedio', 'money'],
  ['products_sold', 'Productos vendidos', 'count'],
  ['cancellations', 'Cancelaciones', 'count'],
  ['no_shows', 'Ausencias', 'count'],
] as const satisfies readonly (readonly [
  keyof FinanceDashboardSummary,
  string,
  'money' | 'count',
])[];

export type FinanceKpiCardsProps = {
  period: FinancePeriod;
  result: FinanceKpiResult;
  onRetry?: () => void;
};

// Read-only presentation of a captured authorized result. BF256 owns fetching,
// selection and query lifetimes; this component neither fetches nor stores data.
export function FinanceKpiCards({ period, result, onRetry }: FinanceKpiCardsProps) {
  const auth = useAuth();
  const business = useBusiness();
  const { width } = useWindowDimensions();
  const unavailable = <EmptyState title="Resumen financiero no disponible" />;
  if (auth.status !== 'authenticated' || business.status !== 'success') return unavailable;
  if (business.data.role !== 'OWNER') return unavailable;
  if (business.isFetching) return <LoadingState message="Verificando negocio…" />;
  if (result.status === 'loading') return <LoadingState message="Cargando resumen financiero…" />;
  if (result.status === 'error')
    return <ErrorState message="No pudimos cargar el resumen financiero." onRetry={onRetry} />;
  if (result.status !== 'success') return unavailable;
  const { scope, data } = result;
  if (
    scope.userId !== auth.user.id ||
    scope.businessId !== business.data.business.id ||
    scope.membershipId !== business.data.membershipId ||
    scope.timezone !== business.data.business.timezone ||
    scope.period !== period
  )
    return unavailable;

  const currency = business.data.business.currency_code;
  const values: string[] = [];
  for (const [field, , kind] of metrics) {
    const value = data?.[field];
    if (field === 'average_ticket' && value === null) {
      values.push('—');
      continue;
    }
    // Missing/malformed transport data is unavailable, never success-zero.
    const pattern =
      kind === 'count' ? /^\d+$/ : field === 'profit' ? /^-?\d+\.\d{2}$/ : /^\d+\.\d{2}$/;
    if (typeof value !== 'string' || !pattern.test(value)) return unavailable;
    const display = kind === 'money' ? formatMoney(value, currency) : value;
    if (display === 'Importe no disponible') return unavailable;
    values.push(display);
  }

  return (
    <View style={styles.grid}>
      {metrics.map(([field, label], index) => (
        <Card
          key={field}
          role="group"
          accessible
          accessibilityLabel={`${label}: ${values[index]}`}
          style={[styles.card, width >= 768 && styles.wideCard]}
        >
          <Text accessible={false} aria-hidden style={styles.label}>
            {label}
          </Text>
          <Text accessible={false} aria-hidden style={styles.value}>
            {values[index]}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[16],
  },
  card: { width: '100%', minWidth: 0, gap: theme.spacing[8] },
  wideCard: { flexBasis: '40%', flexGrow: 1, flexShrink: 1, width: undefined },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textSecondary },
  value: { ...theme.typography.headingLg, color: theme.colors.textPrimary, flexShrink: 1 },
});
