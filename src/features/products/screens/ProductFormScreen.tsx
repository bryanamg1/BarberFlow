import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useProductLifecycle, usableProductId } from '../hooks/useProductLifecycle';
import { useProductDetail } from '../hooks/useProductDetail';
import { ProductForm } from '../components/ProductForm';
import { productStyles as styles } from '../components/productPresentation';
import type { ProductRow } from '../types/product.types';
import { productsKeys } from '../constants/productsKeys';

const cancel = () => (router.canGoBack() ? router.back() : router.replace('/products'));
const saved = (product: ProductRow) =>
  router.replace({ pathname: '/products/[id]', params: { id: product.id } });
export function ProductFormScreen({ productId }: { productId?: string | null }) {
  const editing = productId !== undefined;
  const life = useProductLifecycle(
    JSON.stringify(['product-form-screen', editing, productId]),
    true,
  );
  const business = useBusiness();
  const headerHeight = useHeaderHeight();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <Text role="heading" style={styles.heading}>
            {editing ? 'Editar producto' : 'Nuevo producto'}
          </Text>
          {life.scope && business.status === 'success' ? (
            <Editor
              key={JSON.stringify([life.scope, productId])}
              productId={productId}
              currency={business.data.business.currency_code}
              businessId={life.scope.businessId}
            />
          ) : (
            <>
              {business.status === 'pending' ? (
                <LoadingState message="Cargando negocio…" />
              ) : business.status === 'error' ? (
                <ErrorState message={business.error.message} />
              ) : (
                <EmptyState
                  title="Acceso restringido"
                  message="Solo un OWNER con sesión y negocio disponibles puede gestionar productos."
                />
              )}
              <Button label="Cancelar" variant="secondary" onPress={cancel} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function Editor({
  productId,
  currency,
  businessId,
}: {
  productId: string | null | undefined;
  currency: string;
  businessId: string;
}) {
  const detail = useProductDetail(productId ?? null);
  // TanStack retains this exact query's data after a failed background read.
  // Keep the mounted RHF editor while awaiting the confirmed write's outcome,
  // but block further writes until the existing reader recovers.
  const client = useQueryClient();
  const { scope } = useProductLifecycle(JSON.stringify(['product-editor', productId]), true);
  const loaded = scope
    ? client.getQueryData<ProductRow>(productsKeys.detail(scope, productId ?? null))
    : undefined;
  if (productId === undefined)
    return <ProductForm currency={currency} onCancel={cancel} onSaved={saved} />;
  if (!usableProductId(productId))
    return (
      <>
        <EmptyState title="Producto no disponible" />
        <Button label="Cancelar" onPress={cancel} />
      </>
    );
  if (detail.status === 'pending') return <LoadingState message="Cargando producto…" />;
  if (detail.status === 'error' && loaded === undefined)
    return (
      <>
        <ErrorState
          title={detail.error.code === 'PRODUCT_NOT_FOUND' ? 'Producto no disponible' : undefined}
          message={detail.error.message}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
        <Button label="Cancelar" onPress={cancel} />
      </>
    );
  const product =
    detail.status === 'success' ? detail.data : detail.status === 'error' ? loaded : null;
  if (!product || product.business_id !== businessId || product.id !== productId)
    return (
      <>
        <EmptyState title="Producto no disponible" />
        <Button label="Cancelar" onPress={cancel} />
      </>
    );
  // The form captures initial data once per identity; background reads never reset dirty input.
  return (
    <View style={styles.section}>
      {detail.status === 'error' && (
        <ErrorState
          message={detail.error.message}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      )}
      <ProductForm
        product={product}
        currency={currency}
        readBlocked={detail.status === 'error'}
        onCancel={cancel}
        onSaved={saved}
      />
    </View>
  );
}
