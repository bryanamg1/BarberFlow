import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const business = useBusiness();
  return (
    <View>
      <Text>Detalle de producto</Text>
      {business.status === 'success' &&
        business.data.role === 'OWNER' &&
        typeof id === 'string' && (
          <Button
            label="Ajustar stock"
            onPress={() =>
              router.push({ pathname: '/products/[id]/stock-adjustment', params: { id } })
            }
          />
        )}
    </View>
  );
}
