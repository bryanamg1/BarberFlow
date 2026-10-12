import { useLocalSearchParams } from 'expo-router';

import { ClientEditScreen } from '@/features/clients/screens/ClientEditScreen';

export default function ClientEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const clientId = typeof id === 'string' && id.trim().length > 0 ? id : null;
  return <ClientEditScreen clientId={clientId} />;
}
