import { useLocalSearchParams } from 'expo-router';

import { AppointmentDetailScreen } from '@/features/appointments/screens/AppointmentDetailScreen';

export default function AppointmentDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return <AppointmentDetailScreen appointmentId={typeof id === 'string' ? id : null} />;
}
