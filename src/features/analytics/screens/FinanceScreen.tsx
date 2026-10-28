import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';
import { FinanceKpiCards } from '../components/FinanceKpiCards';
import { FinancePeriodFilter } from '../components/FinancePeriodFilter';
import { FinanceProductsExpensesPanel } from '../components/FinanceProductsExpensesPanel';
import { FinanceRevenueChart } from '../components/FinanceRevenueChart';
import { FinanceServicesPanel } from '../components/FinanceServicesPanel';
import { DEFAULT_FINANCE_TAB, FinanceTabs } from '../components/FinanceTabs';
import { useFinanceQueries } from '../hooks/useFinanceQueries';
import { DEFAULT_FINANCE_PERIOD } from '../utils/financePeriod';

export function FinanceScreen() {
  const [period, setPeriod] = useState(DEFAULT_FINANCE_PERIOD);
  const [tab, setTab] = useState(DEFAULT_FINANCE_TAB);
  const result = useFinanceQueries(tab, period);
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text role="heading" style={styles.title}>
            Finanzas
          </Text>
          {!result.available ? (
            <EmptyState title="Finanzas no disponibles" />
          ) : (
            <>
              <FinancePeriodFilter value={period} onChange={setPeriod} />
              <FinanceTabs value={tab} onChange={setTab} />
              {tab === 'overview' && (
                <>
                  <FinanceKpiCards
                    period={period}
                    result={result.kpis}
                    onRetry={result.retrySummary}
                  />
                  {result.revenue.status === 'success' ? (
                    <FinanceRevenueChart points={result.revenue.data} />
                  ) : result.revenue.status === 'loading' ? (
                    <LoadingState message="Cargando ingresos…" />
                  ) : result.revenue.status === 'error' ? (
                    <ErrorState message="No pudimos cargar los ingresos." />
                  ) : (
                    <EmptyState title="Ingresos no disponibles" />
                  )}
                </>
              )}
              {tab === 'services' && <FinanceServicesPanel result={result.services} />}
              {tab === 'products' && (
                <FinanceProductsExpensesPanel
                  mode="products"
                  productsResult={result.products}
                  expensesResult={{ status: 'unavailable' }}
                />
              )}
              {tab === 'expenses' && (
                <FinanceProductsExpensesPanel
                  mode="expenses"
                  productsResult={{ status: 'unavailable' }}
                  expensesResult={result.expenses}
                />
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16] },
  panel: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing[24] },
  title: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
