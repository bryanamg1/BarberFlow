import { useLocalSearchParams } from 'expo-router';
import { AppointmentEditScreen } from '@/features/appointments/screens/AppointmentEditScreen';

export default function AppointmentEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return <AppointmentEditScreen appointmentId={typeof id === 'string' ? id : null} />;
}
