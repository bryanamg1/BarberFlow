import { Stack } from 'expo-router';
import { SaleHistoryScreen } from '@/features/sales/screens/SaleHistoryScreen';
export default function SaleHistoryRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Historial de ventas' }} />
      <SaleHistoryScreen />
    </>
  );
}
