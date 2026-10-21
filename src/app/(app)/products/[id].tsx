import { useLocalSearchParams } from 'expo-router';
import { ProductDetailScreen } from '@/features/products/screens/ProductDetailScreen';
export default function ProductRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <ProductDetailScreen productId={typeof id === 'string' && id.trim().length > 0 ? id : null} />
  );
}
