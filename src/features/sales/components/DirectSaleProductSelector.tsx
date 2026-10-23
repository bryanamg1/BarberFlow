import { uuid } from 'expo-modules-core';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';

import { Button, Card, EmptyState, ErrorState, LoadingState, SearchInput } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { ProductStockBadge } from '@/features/products/components/ProductStockBadge';
import { useProductList } from '@/features/products/hooks/useProductList';
import { useProductStock } from '@/features/products/hooks/useProductStock';
import { selectProductStock } from '@/features/products/utils/productStock';
import { theme } from '@/theme';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { checkoutDraftStore, sameCheckoutScope } from '../store/checkoutDraftStore';
import { useCheckoutScope } from '../store/useCheckoutScope';
import { addCheckoutProduct } from '../utils/checkoutProductItems';

export function DirectSaleProductSelector() {
  const scope = useCheckoutScope(),
    business = useBusiness();
  const state = useStore(checkoutDraftStore);
  const draft = scope && sameCheckoutScope(scope, state.scope) ? state.draft : null;
  const identity = JSON.stringify([scope, draft?.operationId]);
  const [filters, setFilters] = useState({ identity, page: 1, term: '' });
  const page = filters.identity === identity ? filters.page : 1;
  const term = filters.identity === identity ? filters.term : '';
  const list = useProductList({ page, pageSize: 25, status: 'active' });
  const choices =
    list.status === 'success'
      ? list.data.items.filter(
          (product) => product.is_active && product.business_id === scope?.businessId,
        )
      : [];
  const stock = useProductStock(choices.map((product) => product.id));
  if (
    !scope ||
    !draft ||
    draft.appointmentId !== null ||
    business.status !== 'success' ||
    business.data.role !== 'OWNER'
  )
    return null;
  const locked = state.submission !== null;
  const visible = choices.filter((product) =>
    product.name.toLowerCase().includes(term.toLowerCase()),
  );
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Seleccionar productos
      </Text>
      <SearchInput
        label="Buscar en esta página"
        value={term}
        disabled={locked}
        onChangeText={(value) => setFilters({ identity, page, term: value })}
        helperText="Filtra los productos de la página visible. Usa Siguiente para consultar otra página."
      />
      {list.status === 'pending' ? (
        <LoadingState message="Cargando productos…" />
      ) : list.status === 'error' ? (
        <ErrorState
          message={list.error.message}
          retrying={list.isFetching}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : list.status === 'success' ? (
        <>
          {visible.length === 0 && (
            <EmptyState
              title={
                choices.length === 0
                  ? 'No hay productos activos para seleccionar'
                  : 'No hay coincidencias en esta página'
              }
            />
          )}
          {stock.status === 'error' && (
            <ErrorState
              message="No se pudo consultar el stock del catálogo."
              retrying={stock.isFetching}
              onRetry={() => {
                void stock.refetch();
              }}
            />
          )}
          {visible.map((product) => (
            <Card key={product.id} style={styles.section}>
              <Text style={styles.text}>{product.name}</Text>
              <Text style={styles.hint}>
                {formatCatalogPrice(product.sale_price, business.data.business.currency_code)}
              </Text>
              <ProductStockBadge
                stock={
                  stock.isFetching ? { status: 'pending' } : selectProductStock(stock, product.id)
                }
                minimumStock={product.minimum_stock}
              />
              <Button
                label="Agregar"
                accessibilityLabel={`Agregar producto: ${product.name}`}
                disabled={locked || list.isFetching}
                onPress={() => {
                  addCheckoutProduct(scope, draft.operationId, uuid.v4(), product);
                }}
              />
            </Card>
          ))}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={locked || list.isFetching || page <= 1}
              onPress={() => setFilters({ identity, page: page - 1, term: '' })}
            />
            <Text role="status" style={styles.text}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={locked || list.isFetching || !list.data.hasNextPage}
              onPress={() => setFilters({ identity, page: page + 1, term: '' })}
            />
          </View>
        </>
      ) : (
        <EmptyState title="Catálogo no disponible" />
      )}
      <Text style={styles.hint}>
        Stock orientativo, sin reservas. Cada selección agrega una línea independiente.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
