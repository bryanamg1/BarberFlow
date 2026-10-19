import { useLocalSearchParams } from 'expo-router';

import { PurchaseDetailScreen } from '@/features/purchases/screens/PurchaseDetailScreen';

export default function PurchaseDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return <PurchaseDetailScreen purchaseId={typeof id === 'string' ? id : null} />;
}
