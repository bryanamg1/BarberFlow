import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import { useExpenseCategoryDetail } from '../hooks/useExpenseCategoryDetail';
import { useExpenseCategoryList } from '../hooks/useExpenseCategoryList';
import { expenseStyles as styles } from './expensePresentation';

// One bounded category list and, when needed, one selected historical reference.
// Expense rows never fetch categories individually.
export function ExpenseCategorySelect({
  value,
  onChange,
  disabled = false,
  includeArchived = false,
  allowClear = false,
  error,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  includeArchived?: boolean;
  allowClear?: boolean;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const business = useBusiness();
  const businessId = business.status === 'success' ? business.data.business.id : null;
  const params = { page, pageSize: 25, status: includeArchived ? 'all' : 'active' } as const;
  const categories = useExpenseCategoryList(params);
  const selected = useExpenseCategoryDetail(value ?? null);
  const client = useQueryClient();
  const current =
    selected.status === 'success' &&
    selected.data.business_id === businessId &&
    selected.data.id === value
      ? selected.data
      : null;
  return (
    <View style={styles.section}>
      <Text style={styles.body}>
        {allowClear ? 'Categoría' : 'Categoría (obligatoria)'}:{' '}
        {value
          ? (current?.name ?? 'Selección no disponible')
          : allowClear
            ? 'Todas'
            : 'Sin seleccionar'}
        {current && !current.is_active ? ' · Archivada' : ''}
      </Text>
      {error && (
        <Text role="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Button
        label="Elegir categoría"
        variant="outline"
        disabled={disabled}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
      />
      {open && !disabled && (
        <View style={styles.section}>
          {allowClear && (
            <Button
              label="Todas las categorías"
              variant="secondary"
              onPress={() => {
                onChange(undefined);
                setOpen(false);
              }}
            />
          )}
          {categories.status === 'pending' ? (
            <LoadingState message="Cargando categorías…" />
          ) : categories.status === 'error' ? (
            <ErrorState
              message={categories.error.message}
              retrying={categories.isFetching}
              onRetry={() => {
                void client.invalidateQueries({
                  queryKey: expenseCategoriesKeys.list(businessId, params),
                  exact: true,
                });
              }}
            />
          ) : categories.status === 'success' ? (
            <>
              {categories.data.items.filter(
                (c) => c.business_id === businessId && (includeArchived || c.is_active),
              ).length === 0 && <EmptyState title="No hay categorías disponibles" />}
              {categories.data.items
                .filter((c) => c.business_id === businessId && (includeArchived || c.is_active))
                .map((c) => (
                  <Button
                    key={c.id}
                    label={`${c.name}${c.is_active ? '' : ' · Archivada'}`}
                    variant={value === c.id ? 'primary' : 'outline'}
                    accessibilityLabel={`Seleccionar categoría: ${c.name}${c.is_active ? '' : ', archivada'}`}
                    accessibilityState={{ selected: value === c.id }}
                    disabled={categories.isFetching}
                    onPress={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                  />
                ))}
              <View style={styles.controls}>
                <Button
                  label="Categorías anteriores"
                  variant="secondary"
                  disabled={page <= 1 || categories.isFetching}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                />
                <Text role="status" aria-live="polite" style={styles.hint}>
                  Categorías · Página {page}
                </Text>
                <Button
                  label="Más categorías"
                  variant="secondary"
                  disabled={!categories.data.hasNextPage || categories.isFetching}
                  onPress={() => setPage((p) => p + 1)}
                />
              </View>
            </>
          ) : (
            <EmptyState title="Categorías no disponibles" />
          )}
        </View>
      )}
    </View>
  );
}
