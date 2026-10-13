import { useLocalSearchParams } from 'expo-router';

import { ServiceEditScreen } from '@/features/services/screens/ServiceEditScreen';

export default function EditServiceRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const serviceId = typeof id === 'string' && id.trim().length > 0 ? id : null;
  return <ServiceEditScreen serviceId={serviceId} />;
}
