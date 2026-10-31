import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatCatalogPrice } from '@/utils/formatMoney';
import { productCategoryLabel, productStyles as styles } from '../components/productPresentation';
import { useProductCategoriesByIds } from '../hooks/useProductCategoriesByIds';
import { useProductLifecycle } from '../hooks/useProductLifecycle';
import { useProductList } from '../hooks/useProductList';
import { useProductStock } from '../hooks/useProductStock';
import { ProductStockBadge } from '../components/ProductStockBadge';
import { productStockPresentation } from '../components/productStockPresentation';
import { selectProductStock } from '../utils/productStock';
import type { ProductStockValue } from '../types/productStock.types';
import type { ProductRow } from '../types/product.types';

export function ProductsScreen() {
  const business = useBusiness();
  const { scope } = useProductLifecycle('products-screen');
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Productos
        </Text>
        {scope && business.status === 'success' && (
          <Button
            label="Historial de ventas"
            variant="secondary"
            onPress={() => router.push('/sales')}
          />
        )}
        {scope && business.status === 'success' && business.data.role === 'OWNER' && (
          <View style={styles.controls}>
            <Button label="Crear producto" onPress={() => router.push('/products/new')} />
            <Button label="Nueva venta" onPress={() => router.push('/sales/new')} />
          </View>
        )}
        {scope && business.status === 'success' ? (
          <Catalog key={JSON.stringify(scope)} currency={business.data.business.currency_code} />
        ) : business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : (
          <EmptyState
            title="Productos no disponibles"
            message="Necesitas una sesión y un negocio disponibles para ver productos."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
function Catalog({ currency }: { currency: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [categoryId, setCategoryId] = useState<string>();
  const result = useProductList({ page, pageSize: 25, status, categoryId });
  const items = result.status === 'success' ? result.data.items : [];
  const stock = useProductStock(items.map((product) => product.id));
  const categories = useProductCategoriesByIds(
    items.flatMap((row) => (row.category_id === null ? [] : [row.category_id])),
  );
  return (
    <View style={styles.section}>
      <Button
        label="Categorías"
        variant="secondary"
        onPress={() => router.push('/products/categories')}
      />
      <View style={styles.controls}>
        {(
          [
            { value: 'active', label: 'Activos' },
            { value: 'inactive', label: 'Archivados' },
            { value: 'all', label: 'Todos' },
          ] as const
        ).map((option) => (
          <Button
            key={option.value}
            label={option.label}
            variant={status === option.value ? 'primary' : 'outline'}
            accessibilityState={{ selected: status === option.value }}
            onPress={() => {
              setPage(1);
              setStatus(option.value);
            }}
          />
        ))}
      </View>
      {categoryId !== undefined && (
        <Button
          label="Quitar filtro de categoría"
          variant="ghost"
          onPress={() => {
            setPage(1);
            setCategoryId(undefined);
          }}
        />
      )}
      {result.status === 'pending' ? (
        <LoadingState message="Cargando productos…" />
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
          {stock.status === 'error' && (
            <ErrorState
              title="Stock no disponible"
              message={stock.error.message}
              retrying={stock.isFetching}
              onRetry={() => {
                void stock.refetch();
              }}
            />
          )}
          {categories.status === 'error' && (
            <ErrorState
              title="Categorías no disponibles"
              message={categories.error.message}
              retrying={categories.isFetching}
              onRetry={() => {
                void categories.refetch();
              }}
            />
          )}
          {categories.status === 'success' && categories.data.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.text}>Filtrar por categorías de esta página</Text>
              <View style={styles.controls}>
                {categories.data.map((category) => (
                  <Button
                    key={category.id}
                    label={`Filtrar por ${category.name}${category.is_active ? '' : ' (archivada)'}`}
                    variant="outline"
                    onPress={() => {
                      setPage(1);
                      setCategoryId(category.id);
                    }}
                  />
                ))}
              </View>
            </View>
          )}
          {items.length === 0 ? (
            <EmptyState title="No hay productos para estos filtros." />
          ) : (
            items.map((product) => (
              <ProductRowLink
                key={product.id}
                product={product}
                currency={currency}
                category={productCategoryLabel(product.category_id, categories)}
                stock={selectProductStock(stock, product.id)}
              />
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1}
              onPress={() => setPage(page - 1)}
            />
            <Text role="status" aria-live="polite" style={styles.text}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage}
              onPress={() => setPage(page + 1)}
            />
          </View>
        </>
      ) : (
        <EmptyState title="Productos no disponibles" />
      )}
    </View>
  );
}
function ProductRowLink({
  product,
  currency,
  category,
  stock,
}: {
  product: ProductRow;
  currency: string;
  category: string;
  stock: ProductStockValue;
}) {
  const [focused, setFocused] = useState(false);
  const status = product.is_active ? 'Activo' : 'Archivado';
  return (
    <Pressable
      role="button"
      aria-label={`Ver producto ${product.name}, ${status}. ${productStockPresentation(stock, product.minimum_stock).label}`}
      accessibilityHint="Abre el detalle del producto"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => router.push({ pathname: '/products/[id]', params: { id: product.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, focused && styles.focused]}
    >
      <Text style={styles.name}>{product.name}</Text>
      <Text style={styles.text}>
        Precio de venta: {formatCatalogPrice(product.sale_price, currency)}
      </Text>
      <Text style={styles.text}>{category}</Text>
      <Badge label={status} tone={product.is_active ? 'success' : 'neutral'} />
      <ProductStockBadge stock={stock} minimumStock={product.minimum_stock} />
    </Pressable>
  );
}
