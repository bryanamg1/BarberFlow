import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import { useExpenseCategoryList } from '../hooks/useExpenseCategoryList';
import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import type { ExpenseCategoryListParams } from '../types/expenseCategory.types';

const statuses = [
  { value: 'active', label: 'Activas' },
  { value: 'inactive', label: 'Archivadas' },
  { value: 'all', label: 'Todas' },
] as const;

export function ExpenseCategoriesScreen() {
  const business = useBusiness();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Categorías de gastos
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : business.status === 'success' ? (
          business.data.role === 'OWNER' ? (
            <BusinessExpenseCategories
              key={business.data.business.id}
              businessId={business.data.business.id}
            />
          ) : (
            <EmptyState
              title="Acceso restringido"
              message="Solo un OWNER puede gestionar categorías de gastos."
            />
          )
        ) : (
          <EmptyState
            title="Negocio no disponible"
            message="Necesitas un negocio disponible para ver categorías."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BusinessExpenseCategories({ businessId }: { businessId: string }) {
  const [status, setStatus] = useState<Required<ExpenseCategoryListParams>['status']>('active');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 25, status };
  const result = useExpenseCategoryList(params);
  const queryClient = useQueryClient();

  return (
    <View style={styles.section}>
      <Button label="Crear categoría" onPress={() => router.push('/expenses/categories/new')} />
      <View style={styles.controls}>
        {statuses.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            variant={status === option.value ? 'primary' : 'outline'}
            accessibilityState={{ selected: status === option.value }}
            onPress={() => {
              if (status !== option.value) setPage(1);
              setStatus(option.value);
            }}
          />
        ))}
      </View>
      {result.status === 'pending' ? (
        <LoadingState message="Cargando categorías…" />
      ) : result.status === 'idle' ? (
        <EmptyState title="Categorías no disponibles" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: expenseCategoriesKeys.list(businessId, params),
              exact: true,
            });
          }}
        />
      ) : (
        <View style={styles.section}>
          {result.data.items.length === 0 ? (
            <EmptyState
              title={
                status === 'active'
                  ? 'No hay categorías activas.'
                  : status === 'inactive'
                    ? 'No hay categorías archivadas.'
                    : 'No hay categorías registradas.'
              }
            />
          ) : (
            result.data.items.map((expenseCategory) => (
              <ExpenseCategoryListItem key={expenseCategory.id} expenseCategory={expenseCategory} />
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1}
              onPress={() => {
                if (page > 1) setPage(page - 1);
              }}
            />
            <Text role="status" aria-live="polite" style={styles.secondary}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage}
              onPress={() => {
                if (result.data.hasNextPage) setPage(page + 1);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function ExpenseCategoryListItem({ expenseCategory }: { expenseCategory: ExpenseCategoryRow }) {
  const [focused, setFocused] = useState(false);
  const state = expenseCategory.is_active ? 'Activa' : 'Archivada';
  const label = `${expenseCategory.name}, ${state}`;
  const content = (
    <>
      <Text style={styles.name}>{expenseCategory.name}</Text>
      <View style={styles.metadata}>
        <Badge label={state} tone={expenseCategory.is_active ? 'success' : 'neutral'} />
      </View>
    </>
  );

  return (
    <Pressable
      accessible
      role="button"
      aria-label={`Editar categoría ${label}`}
      accessibilityHint="Abre la edición de la categoría"
      onPress={() =>
        router.push({
          pathname: '/expenses/categories/[id]/edit',
          params: { id: expenseCategory.id },
        })
      }
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressedRow,
        focused && styles.focusedRow,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    padding: theme.spacing[16],
    gap: theme.spacing[24],
    width: '100%',
    alignSelf: 'center',
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  secondary: { ...theme.typography.body, color: theme.colors.textSecondary },
  name: { ...theme.typography.bodyLg, color: theme.colors.textPrimary, flexShrink: 1 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing[12],
  },
  row: {
    minHeight: theme.sizing.touchTarget,
    padding: theme.spacing[16],
    gap: theme.spacing[12],
    borderRadius: theme.radius.card,
    borderWidth: theme.borderWidths.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceRaised,
    ...theme.shadows.raised,
  },
  pressedRow: { backgroundColor: theme.colors.surfaceStrong },
  focusedRow: {
    borderColor: theme.colors.primary,
    ...Platform.select({
      web: {
        outlineStyle: 'solid',
        outlineColor: theme.colors.primary,
        outlineWidth: theme.borderWidths.thin,
        outlineOffset: theme.spacing[4],
      },
    }),
  },
});
