import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, LoadingState } from '@/components/ui';
import { useProductCategoryList } from '../hooks/useProductCategoryList';
import { productCategoriesKeys } from '../constants/productCategoriesKeys';
import { productStyles as styles } from './productPresentation';

export function ProductCategoryField({
  businessId,
  value,
  label,
  disabled,
  onChange,
}: {
  businessId: string;
  value: string | null | undefined;
  label: string;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 25, status: 'active' as const };
  const result = useProductCategoryList(params);
  const client = useQueryClient();
  return (
    <View style={styles.section}>
      <Text style={styles.text}>Categoría: {label}</Text>
      <Button
        label="Sin categoría"
        variant={value == null ? 'primary' : 'outline'}
        accessibilityState={{ selected: value == null }}
        disabled={disabled}
        onPress={() => {
          if (!disabled) onChange(null);
        }}
      />
      {result.status === 'pending' ? (
        <LoadingState message="Cargando categorías…" />
      ) : result.status === 'error' ? (
        <ErrorState
          message="No se pudieron cargar las categorías."
          retrying={result.isFetching}
          onRetry={() => {
            void client.invalidateQueries({
              queryKey: productCategoriesKeys.list(businessId, params),
              exact: true,
            });
          }}
        />
      ) : result.status === 'success' ? (
        <>
          {result.data.items
            .filter((c) => c.business_id === businessId && c.is_active)
            .map((c) => (
              <Button
                key={c.id}
                label={`Categoría: ${c.name}`}
                variant={value === c.id ? 'primary' : 'outline'}
                accessibilityState={{ selected: value === c.id }}
                disabled={disabled}
                onPress={() => {
                  if (!disabled) onChange(c.id);
                }}
              />
            ))}
          {result.data.items.length === 0 && (
            <Text style={styles.text}>No hay categorías activas en esta página.</Text>
          )}
          <View style={styles.controls}>
            <Button
              label="Categorías anteriores"
              disabled={disabled || page === 1 || result.isFetching}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
            />
            <Text style={styles.text}>Página de categorías {page}</Text>
            <Button
              label="Más categorías"
              disabled={disabled || !result.data.hasNextPage || result.isFetching}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
