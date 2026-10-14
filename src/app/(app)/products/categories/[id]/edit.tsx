import { useLocalSearchParams } from 'expo-router';
import { ProductCategoryEditScreen } from '@/features/products/screens/ProductCategoryEditScreen';
export default function ProductCategoryEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <ProductCategoryEditScreen
      productCategoryId={typeof id === 'string' && id.trim() ? id : null}
    />
  );
}
