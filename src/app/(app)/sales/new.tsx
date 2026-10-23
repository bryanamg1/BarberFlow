import { useLocalSearchParams } from 'expo-router';

import { CheckoutScreen } from '@/features/sales/screens/CheckoutScreen';

export default function NewSaleScreen() {
  const { appointmentId, clientId } = useLocalSearchParams<{
    appointmentId?: string | string[];
    clientId?: string | string[];
  }>();
  const validContext =
    (appointmentId === undefined || typeof appointmentId === 'string') &&
    (clientId === undefined || typeof clientId === 'string');
  return (
    <CheckoutScreen
      appointmentId={typeof appointmentId === 'string' ? appointmentId : null}
      clientId={typeof clientId === 'string' ? clientId : null}
      validContext={validContext}
    />
  );
}
