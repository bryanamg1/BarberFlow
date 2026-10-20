import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { ExpenseAccess } from '../components/ExpenseAccess';
import { ExpenseCategorySelect } from '../components/ExpenseCategorySelect';
import { expensePaymentLabel, expenseStyles as styles } from '../components/expensePresentation';
import { useExpenseLifecycle } from '../hooks/useExpenseLifecycle';
import { useExpenses } from '../hooks/useExpenses';
import type { ExpenseListParams } from '../types/expense.types';
import { normalizeExpenseListParams } from '../utils/expenseListParams';

export function ExpensesScreen() {
  const { scope } = useExpenseLifecycle('expenses-screen');
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Gastos
        </Text>
        {scope ? <ExpenseList key={JSON.stringify(scope)} /> : <ExpenseAccess />}
      </ScrollView>
    </SafeAreaView>
  );
}

function ExpenseList() {
  const business = useBusiness();
  const [params, setParams] = useState<ExpenseListParams>({ page: 1, pageSize: 25 });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateError, setDateError] = useState(false);
  const result = useExpenses(params);
  const filter = (values: Partial<ExpenseListParams>) =>
    setParams((old) => ({ ...old, ...values, page: 1 }));
  if (business.status !== 'success') return null;
  return (
    <View style={styles.section}>
      <Button label="Nuevo gasto" onPress={() => router.push('/expenses/new')} />
      <View style={styles.controls}>
        {(
          [
            { label: 'Todos los orígenes', value: undefined },
            { label: 'Manuales', value: 'MANUAL' },
            { label: 'Compras', value: 'PURCHASE' },
          ] as const
        ).map((option) => (
          <Button
            key={option.label}
            label={option.label}
            variant={params.sourceType === option.value ? 'primary' : 'outline'}
            accessibilityState={{ selected: params.sourceType === option.value }}
            onPress={() => filter({ sourceType: option.value })}
          />
        ))}
      </View>
      <ExpenseCategorySelect
        value={params.categoryId}
        includeArchived
        allowClear
        onChange={(categoryId) => filter({ categoryId })}
      />
      <Input label="Desde (YYYY-MM-DD)" value={from} onChangeText={setFrom} autoCapitalize="none" />
      <Input
        label="Hasta, sin incluir (YYYY-MM-DD)"
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
      />
      {dateError && (
        <Text role="alert" style={styles.error}>
          Revisa las fechas y su orden.
        </Text>
      )}
      <Button
        label="Aplicar fechas"
        variant="secondary"
        onPress={() => {
          const dates = { from: from || undefined, to: to || undefined };
          if (normalizeExpenseListParams({ ...params, ...dates, page: 1 }) === null) {
            setDateError(true);
            return;
          }
          setDateError(false);
          filter(dates);
        }}
      />
      {result.status === 'pending' ? (
        <LoadingState message="Cargando gastos…" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={() => {
            void result.refetch();
          }}
        />
      ) : result.status === 'success' ? (
        <>
          {result.data.items.length === 0 ? (
            <EmptyState title="No hay gastos para estos filtros" />
          ) : (
            result.data.items.map((item) => (
              <Card key={item.id} style={styles.section}>
                <Text style={styles.title}>{item.description || 'Sin descripción'}</Text>
                <Text style={styles.body}>
                  {formatCatalogPrice(item.amount, business.data.business.currency_code)}
                </Text>
                <Text style={styles.hint}>
                  {item.expense_date} · {expensePaymentLabel(item.payment_method)}
                </Text>
                <Badge label={item.source_type === 'MANUAL' ? 'Manual' : 'Compra'} />
                {item.source_type === 'MANUAL' ? (
                  <Button
                    label="Editar"
                    variant="outline"
                    accessibilityLabel={`Editar gasto: ${item.description || 'Sin descripción'}, ${item.expense_date}`}
                    onPress={() =>
                      router.push(`/expenses/${encodeURIComponent(item.id)}/edit` as Href)
                    }
                  />
                ) : (
                  <Text style={styles.hint}>Solo lectura</Text>
                )}
              </Card>
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={result.data.page <= 1 || result.isFetching}
              onPress={() => setParams((old) => ({ ...old, page: result.data.page - 1 }))}
            />
            <Text role="status" aria-live="polite" style={styles.body}>
              Página {result.data.page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage || result.isFetching}
              onPress={() => setParams((old) => ({ ...old, page: result.data.page + 1 }))}
            />
          </View>
        </>
      ) : (
        <EmptyState title="Gastos no disponibles" />
      )}
    </View>
  );
}
