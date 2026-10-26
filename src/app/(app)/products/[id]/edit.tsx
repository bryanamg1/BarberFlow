import { useLocalSearchParams } from 'expo-router';
import { ProductFormScreen } from '@/features/products/screens/ProductFormScreen';
export default function EditProductRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return <ProductFormScreen productId={typeof id === 'string' && id.trim() ? id : null} />;
}
