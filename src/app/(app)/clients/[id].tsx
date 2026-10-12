import { useLocalSearchParams } from 'expo-router';

import { ClientDetailScreen } from '@/features/clients/screens/ClientDetailScreen';

export default function ClientDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const clientId = typeof id === 'string' && id.trim().length > 0 ? id : null;
  return <ClientDetailScreen clientId={clientId} />;
}
