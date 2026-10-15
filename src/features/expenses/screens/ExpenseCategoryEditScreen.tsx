import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { ExpenseCategoryForm } from '../components/ExpenseCategoryForm';
import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import { useExpenseCategoryDetail } from '../hooks/useExpenseCategoryDetail';

const cancel = () => {
  if (router.canGoBack()) router.back();
  else router.replace('/expenses/categories');
};

export function ExpenseCategoryEditScreen({
  expenseCategoryId,
}: {
  expenseCategoryId: string | null;
}) {
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
            Editar categoría
          </Text>
          {business.status === 'success' &&
          business.data.role === 'OWNER' &&
          expenseCategoryId !== null ? (
            <ExpenseCategoryEditor
              key={JSON.stringify([business.data.business.id, expenseCategoryId])}
              expenseCategoryId={expenseCategoryId}
              businessId={business.data.business.id}
            />
          ) : (
            <>
              {business.status === 'pending' ? (
                <LoadingState message="Cargando negocio…" />
              ) : business.status === 'error' ? (
                <ErrorState message={business.error.message} />
              ) : business.status === 'success' && business.data.role !== 'OWNER' ? (
                <EmptyState
                  title="Acceso restringido"
                  message="Solo un OWNER puede gestionar categorías."
                />
              ) : (
                <EmptyState title="Categoría no disponible" />
              )}
              <Button label="Cancelar" variant="secondary" onPress={cancel} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ExpenseCategoryEditor({
  expenseCategoryId,
  businessId,
}: {
  expenseCategoryId: string;
  businessId: string;
}) {
  const detail = useExpenseCategoryDetail(expenseCategoryId);
  const queryClient = useQueryClient();
  if (detail.status === 'success')
    return (
      <ExpenseCategoryForm
        mode="edit"
        expenseCategoryId={expenseCategoryId}
        initialExpenseCategory={detail.data}
        onCancel={cancel}
      />
    );
  return (
    <>
      {detail.status === 'pending' ? (
        <LoadingState message="Cargando categoría…" />
      ) : detail.status === 'error' ? (
        detail.error.code === 'EXPENSE_CATEGORY_NOT_FOUND' ? (
          <EmptyState title="Categoría no encontrada" message={detail.error.message} />
        ) : (
          <ErrorState
            message={detail.error.message}
            retrying={detail.isFetching}
            onRetry={() => {
              void queryClient.invalidateQueries({
                queryKey: expenseCategoriesKeys.detail(businessId, expenseCategoryId),
                exact: true,
              });
            }}
          />
        )
      ) : (
        <EmptyState title="Categoría no disponible" />
      )}
      <Button label="Cancelar" variant="secondary" onPress={cancel} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  content: {
    width: '100%',
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
