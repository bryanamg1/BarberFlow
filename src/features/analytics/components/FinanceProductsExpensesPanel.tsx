import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';

import type { FinanceExpensesResult, FinanceProductsResult } from '../types/finance.types';

export type FinanceProductsExpensesPanelProps = {
  productsResult: FinanceProductsResult;
  expensesResult: FinanceExpensesResult;
  mode?: 'products' | 'expenses' | 'both';
};

function displayAmount(value: unknown, currency: string, signed = false): string | null {
  if (typeof value !== 'string' || !(signed ? /^-?\d+\.\d{2}$/ : /^\d+\.\d{2}$/).test(value))
    return null;
  const display = formatMoney(value, currency);
  return display === 'Importe no disponible' ? null : display;
}

function Products({
  result,
  currency,
  wide,
}: {
  result: FinanceProductsResult;
  currency: string;
  wide: boolean;
}) {
  const unavailable = <EmptyState title="Productos financieros no disponibles" />;
  if (result.status === 'loading') return <LoadingState message="Cargando productos…" />;
  if (result.status === 'error') return <ErrorState message="No pudimos cargar los productos." />;
  if (result.status !== 'success' || !Array.isArray(result.data)) return unavailable;
  const identities = new Set<string>();
  const rows: { id: string; fields: readonly (readonly [string, string])[] }[] = [];
  for (const row of result.data) {
    if (
      !row ||
      typeof row.product_id !== 'string' ||
      !row.product_id.trim() ||
      identities.has(row.product_id) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      typeof row.quantity !== 'string' ||
      !/^\d+$/.test(row.quantity)
    )
      return unavailable;
    const revenue = displayAmount(row.net_revenue, currency);
    const cogs = displayAmount(row.cogs, currency);
    const profit = displayAmount(row.gross_profit, currency, true);
    if (revenue === null || cogs === null || profit === null) return unavailable;
    identities.add(row.product_id);
    rows.push({
      id: row.product_id,
      fields: [
        ['Producto', row.name],
        ['Cantidad', row.quantity],
        ['Ingresos netos', revenue],
        ['Costo', cogs],
        ['Ganancia bruta', profit],
      ],
    });
  }
  if (!rows.length) return <EmptyState title="Sin productos vendidos en este período" />;
  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <Card
          key={row.id}
          role="group"
          accessible
          accessibilityLabel={row.fields.map(([label, value]) => `${label}: ${value}`).join('. ')}
          style={[styles.row, wide && styles.wideRow]}
        >
          {row.fields.map(([label, value]) => (
            <View
              key={label}
              aria-hidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.cell, wide && styles.wideCell]}
            >
              <Text accessible={false} style={styles.label}>
                {label}
              </Text>
              <Text accessible={false} style={styles.value}>
                {value}
              </Text>
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}

function Expenses({
  result,
  currency,
  wide,
}: {
  result: FinanceExpensesResult;
  currency: string;
  wide: boolean;
}) {
  const unavailable = <EmptyState title="Gastos financieros no disponibles" />;
  if (result.status === 'loading') return <LoadingState message="Cargando gastos…" />;
  if (result.status === 'error') return <ErrorState message="No pudimos cargar los gastos." />;
  if (result.status !== 'success' || !result.data || !Array.isArray(result.data.by_category))
    return unavailable;
  const data = result.data;
  const totals: { label: string; amount: string }[] = [];
  for (const [field, label] of [
    ['manual_total', 'Gastos manuales'],
    ['purchase_total', 'Compras de mercadería'],
    ['total', 'Total de egresos'],
  ] as const) {
    const amount = displayAmount(data[field], currency);
    if (amount === null) return unavailable;
    totals.push({ label, amount });
  }
  const categories: { id: string | null; label: string; amount: string }[] = [];
  const identities = new Set<string | null>();
  for (const category of data.by_category) {
    if (
      !category ||
      (category.category_id !== null && typeof category.category_id !== 'string') ||
      identities.has(category.category_id)
    )
      return unavailable;
    const amount = displayAmount(category.amount, currency);
    if (amount === null) return unavailable;
    identities.add(category.category_id);
    categories.push({
      id: category.category_id,
      label: category.category_id === null ? 'Sin categoría' : `Categoría ${category.category_id}`,
      amount,
    });
  }
  return (
    <View style={styles.list}>
      <View style={[styles.row, wide && styles.wideRow]}>
        {totals.map(({ label, amount }) => (
          <Card
            key={label}
            role="group"
            accessible
            accessibilityLabel={`${label}: ${amount}`}
            style={[styles.cell, wide && styles.wideCell]}
          >
            <Text accessible={false} aria-hidden style={styles.label}>
              {label}
            </Text>
            <Text accessible={false} aria-hidden style={styles.value}>
              {amount}
            </Text>
          </Card>
        ))}
      </View>
      {categories.length > 0 && (
        <View style={styles.list}>
          <Text role="heading" style={styles.label}>
            Desglose por categoría
          </Text>
          {categories.map((category) => (
            <Card
              key={category.id ?? 'uncategorized'}
              role="group"
              accessible
              accessibilityLabel={`${category.label}: ${category.amount}`}
            >
              <Text accessible={false} aria-hidden style={styles.label}>
                {category.label}
              </Text>
              <Text accessible={false} aria-hidden style={styles.value}>
                {category.amount}
              </Text>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

// BF256 supplies independent current-context results; no queries or period state here.
export function FinanceProductsExpensesPanel({
  productsResult,
  expensesResult,
  mode = 'both',
}: FinanceProductsExpensesPanelProps) {
  const auth = useAuth();
  const business = useBusiness();
  const { width } = useWindowDimensions();
  if (
    auth.status !== 'authenticated' ||
    business.status !== 'success' ||
    business.data.role !== 'OWNER' ||
    business.isFetching
  )
    return <EmptyState title="Panel financiero no disponible" />;
  const currency = business.data.business.currency_code;
  const wide = width >= 768;
  return (
    <View style={styles.panel}>
      {mode !== 'expenses' && (
        <View style={styles.list}>
          <Text role="heading" style={styles.heading}>
            Productos
          </Text>
          <Products result={productsResult} currency={currency} wide={wide} />
        </View>
      )}
      {mode !== 'products' && (
        <View style={styles.list}>
          <Text role="heading" style={styles.heading}>
            Gastos
          </Text>
          <Expenses result={expensesResult} currency={currency} wide={wide} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing[24] },
  list: { gap: theme.spacing[12] },
  row: { gap: theme.spacing[16] },
  wideRow: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { minWidth: 0, gap: theme.spacing[4] },
  wideCell: { flex: 1 },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  label: { ...theme.typography.caption, color: theme.colors.textSecondary },
  value: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
});
