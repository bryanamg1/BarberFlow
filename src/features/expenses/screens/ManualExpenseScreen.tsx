import { useHeaderHeight } from 'expo-router/react-navigation';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { ExpenseAccess } from '../components/ExpenseAccess';
import { ManualExpenseForm } from '../components/ManualExpenseForm';
import { expenseStyles as styles } from '../components/expensePresentation';
import { useExpenseDetail } from '../hooks/useExpenseDetail';
import { usableExpenseId, useExpenseLifecycle } from '../hooks/useExpenseLifecycle';
import type { ExpenseRow } from '../types/expense.types';

export const ExpenseCreateScreen = () => <ManualExpenseScreen mode="create" />;
export const ExpenseEditScreen = ({
  expenseId,
  receiptFailed,
}: {
  expenseId: string | null;
  receiptFailed?: boolean;
}) => <ManualExpenseScreen mode="edit" expenseId={expenseId} receiptFailed={receiptFailed} />;

function ManualExpenseScreen({
  mode,
  expenseId = null,
  receiptFailed = false,
}: {
  mode: 'create' | 'edit';
  expenseId?: string | null;
  receiptFailed?: boolean;
}) {
  const { scope } = useExpenseLifecycle(`expense-screen:${mode}:${expenseId}`);
  const business = useBusiness();
  const headerHeight = useHeaderHeight();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
        keyboardVerticalOffset={headerHeight}
        style={styles.fill}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <Text role="heading" style={styles.heading}>
            {mode === 'create' ? 'Nuevo gasto' : 'Editar gasto'}
          </Text>
          {scope && business.status === 'success' ? (
            mode === 'create' ? (
              <ManualExpenseForm
                key={JSON.stringify([scope, mode])}
                mode="create"
                currency={business.data.business.currency_code}
                receiptFailed={receiptFailed}
              />
            ) : (
              <EditExpense
                key={JSON.stringify([scope, expenseId])}
                expenseId={expenseId}
                currency={business.data.business.currency_code}
                receiptFailed={receiptFailed}
              />
            )
          ) : (
            <ExpenseAccess />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EditExpense({
  expenseId,
  currency,
  receiptFailed,
}: {
  expenseId: string | null;
  currency: string;
  receiptFailed?: boolean;
}) {
  const detail = useExpenseDetail(expenseId);
  // Form hydration snapshot, not a second remote cache. Keep an existing draft on read refresh errors.
  const [initial, setInitial] = useState<ExpenseRow | null>(() =>
    detail.status === 'success' ? detail.data : null,
  );
  // Adjust once when the first read arrives; no effect/render loop or refetch-driven draft reset.
  if (initial === null && detail.status === 'success') setInitial(detail.data);
  const purchase =
    (detail.status === 'success' ? detail.data : initial)?.source_type === 'PURCHASE';
  const back = (
    <Button
      label="Volver a gastos"
      variant="secondary"
      onPress={() => router.replace('/expenses' as Href)}
    />
  );
  if (!usableExpenseId(expenseId))
    return (
      <>
        <EmptyState title="Gasto no disponible" />
        {back}
      </>
    );
  if (purchase)
    return (
      <>
        <EmptyState
          title="Gasto de compra: solo lectura"
          message="Este gasto se gestiona desde su compra de origen."
        />
        {back}
      </>
    );
  return (
    <>
      {detail.status === 'error' && (
        <ErrorState
          message={detail.error.message}
          retrying={detail.isFetching}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      )}
      {initial ? (
        <ManualExpenseForm
          mode="edit"
          initialExpense={initial}
          currency={currency}
          receiptFailed={receiptFailed}
        />
      ) : (
        <>
          {detail.status === 'pending' || detail.status === 'success' ? (
            <LoadingState message="Cargando gasto…" />
          ) : detail.status === 'idle' ? (
            <EmptyState title="Gasto no disponible" />
          ) : null}
          {back}
        </>
      )}
    </>
  );
}
