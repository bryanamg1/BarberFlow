import { router } from 'expo-router';
import { Button } from '@/components/ui';

import { Text, View } from 'react-native';

export default function ProductsScreen() {
  return (
    <View>
      <Text>Productos</Text>
      <Button label="Categorías" onPress={() => router.push('/products/categories')} />
    </View>
  );
}
