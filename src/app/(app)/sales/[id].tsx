import { useLocalSearchParams } from 'expo-router';

import { SaleDetailScreen } from '@/features/sales/screens/SaleDetailScreen';

export default function SaleDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return <SaleDetailScreen saleId={typeof id === 'string' ? id : null} />;
}
