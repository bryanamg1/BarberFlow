import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';

import type { FinanceRevenuePoint } from '../types/finance.types';
import { financeRevenueGeometry } from '../utils/financeRevenueGeometry';

export type FinanceRevenueChartProps = { points: readonly FinanceRevenuePoint[] };
const columnSlot = theme.sizing.touchTarget + theme.spacing[16];

// BF256 supplies only successful, current-context points. It owns loading,
// errors, unavailable query results and period/tenant lifetimes, not this chart.
export function FinanceRevenueChart({ points }: FinanceRevenueChartProps) {
  const auth = useAuth();
  const business = useBusiness();
  const { width } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(0);
  const geometry = useMemo(() => financeRevenueGeometry(points), [points]);
  const unavailable = <EmptyState title="Gráfico de ingresos no disponible" />;
  if (
    auth.status !== 'authenticated' ||
    business.status !== 'success' ||
    business.data.role !== 'OWNER' ||
    business.isFetching ||
    !geometry
  )
    return unavailable;
  const currency = business.data.business.currency_code;
  const maximumLabel = formatMoney(geometry.maxTotal, currency);
  if (maximumLabel === 'Importe no disponible') return unavailable;
  if (!points.length) return <EmptyState title="Sin ingresos en este período" />;
  const plotHeight = theme.sizing.touchTarget * (width >= 768 ? 5 : 4);
  const plotWidth = Math.max(availableWidth, points.length * columnSlot);

  return (
    <Card style={styles.card}>
      <Text role="heading" style={styles.title}>
        Ingresos por día
      </Text>
      <View role="group" accessibilityLabel="Series de ingresos" style={styles.legend}>
        <Text style={[styles.label, styles.serviceLabel]}>Servicios</Text>
        <Text style={[styles.label, styles.productLabel]}>Productos</Text>
      </View>
      <Text style={styles.caption}>
        Escala: {formatMoney('0.00', currency)} → {maximumLabel}
      </Text>
      <View onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          accessibilityLabel="Gráfico de ingresos por fecha, con desplazamiento horizontal"
          {...(Platform.OS === 'web' ? { tabIndex: 0 as const } : {})}
        >
          <View style={[styles.plot, { width: plotWidth }]}>
            {geometry.points.map(({ point, compactDateLabel, serviceRatio, productRatio }) => (
              <View
                key={point.date}
                style={styles.column}
                aria-hidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={[styles.bar, { height: plotHeight }]}>
                  <View style={[styles.service, { height: plotHeight * serviceRatio }]} />
                  <View style={[styles.product, { height: plotHeight * productRatio }]} />
                </View>
                <Text style={styles.caption}>{compactDateLabel}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <Text style={styles.caption}>Fecha · detalle de ingresos</Text>
      <View style={styles.details}>
        {geometry.points.map(({ point, dateLabel }) => {
          const detail = `Servicios: ${formatMoney(point.service_revenue, currency)} · Productos: ${formatMoney(point.product_revenue, currency)} · Total: ${formatMoney(point.total_revenue, currency)}`;
          return (
            <View
              key={point.date}
              accessible
              accessibilityLabel={`${dateLabel}. ${detail}`}
              style={styles.detail}
            >
              <Text accessible={false} aria-hidden style={styles.label}>
                {dateLabel}
              </Text>
              <Text accessible={false} aria-hidden style={styles.caption}>
                {detail}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing[16] },
  title: { ...theme.typography.heading, color: theme.colors.textPrimary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[16] },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
  caption: { ...theme.typography.caption, color: theme.colors.textSecondary },
  serviceLabel: { color: theme.colors.primary },
  productLabel: { color: theme.colors.accent },
  plot: { flexDirection: 'row' },
  column: { flex: 1, minWidth: columnSlot, alignItems: 'center', gap: theme.spacing[8] },
  bar: {
    width: theme.spacing[24],
    flexDirection: 'column-reverse',
    borderBottomWidth: theme.borderWidths.thin,
    borderColor: theme.colors.borderStrong,
  },
  service: { backgroundColor: theme.colors.primary },
  product: { backgroundColor: theme.colors.accent },
  details: { gap: theme.spacing[12] },
  detail: { gap: theme.spacing[4] },
});
