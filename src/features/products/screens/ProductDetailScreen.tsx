import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatCatalogPrice } from '@/utils/formatMoney';
import { productCategoryLabel, productStyles as styles } from '../components/productPresentation';
import { useProductCategoriesByIds } from '../hooks/useProductCategoriesByIds';
import { useProductDetail } from '../hooks/useProductDetail';
import { useProductLifecycle } from '../hooks/useProductLifecycle';

export function ProductDetailScreen({ productId }: { productId: string | null }) {
  const { scope } = useProductLifecycle('product-detail-screen');
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Detalle de producto
        </Text>
        {scope ? (
          <Detail key={JSON.stringify({ scope, productId })} productId={productId} />
        ) : (
          <EmptyState title="Producto no disponible" />
        )}
        <Button
          label="Volver a productos"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/products'))}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
function Detail({ productId }: { productId: string | null }) {
  const result = useProductDetail(productId);
  const business = useBusiness();
  const product = result.status === 'success' ? result.data : null;
  const categories = useProductCategoriesByIds(product?.category_id ? [product.category_id] : []);
  if (result.status === 'pending') return <LoadingState message="Cargando producto…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        title={result.error.code === 'PRODUCT_NOT_FOUND' ? 'Producto no disponible' : undefined}
        message={result.error.message}
        retrying={result.isFetching}
        onRetry={() => {
          void result.refetch();
        }}
      />
    );
  if (!product || business.status !== 'success')
    return <EmptyState title="Producto no disponible" />;
  const currency = business.data.business.currency_code;
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        {product.name}
      </Text>
      <Badge
        label={product.is_active ? 'Activo' : 'Archivado'}
        tone={product.is_active ? 'success' : 'neutral'}
      />
      <Card style={styles.section}>
        <Text style={styles.text}>
          Categoría: {productCategoryLabel(product.category_id, categories)}
        </Text>
        <Text style={styles.text}>
          Precio de venta: {formatCatalogPrice(product.sale_price, currency)}
        </Text>
        <Text style={styles.text}>
          Costo de compra de referencia:{' '}
          {formatCatalogPrice(product.default_purchase_cost, currency)}
        </Text>
        <Text style={styles.text}>Stock mínimo: {product.minimum_stock}</Text>
        <Text style={styles.text}>SKU: {product.sku ?? 'No especificado'}</Text>
        <Text style={styles.text}>Descripción: {product.description ?? 'No especificada'}</Text>
      </Card>
      {categories.status === 'error' && (
        <ErrorState
          title="Categoría no disponible"
          message={categories.error.message}
          retrying={categories.isFetching}
          onRetry={() => {
            void categories.refetch();
          }}
        />
      )}
      {business.data.role === 'OWNER' && (
        <Button
          label="Ajustar stock"
          onPress={() =>
            router.push({ pathname: '/products/[id]/stock-adjustment', params: { id: product.id } })
          }
        />
      )}
    </View>
  );
}
