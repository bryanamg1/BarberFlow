import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="appointments/new" options={{ title: 'Nueva cita' }} />
      <Stack.Screen name="appointments/[id]" options={{ title: 'Detalle de cita' }} />
      <Stack.Screen name="clients/new" options={{ title: 'Nuevo cliente' }} />
      <Stack.Screen name="clients/[id]" options={{ title: 'Detalle de cliente' }} />
      <Stack.Screen name="clients/[id]/edit" options={{ title: 'Editar cliente' }} />
      <Stack.Screen name="products/index" options={{ title: 'Productos' }} />
      <Stack.Screen name="products/new" options={{ title: 'Nuevo producto' }} />
      <Stack.Screen name="products/[id]" options={{ title: 'Detalle de producto' }} />
      <Stack.Screen name="expenses/new" options={{ title: 'Nuevo gasto' }} />
      <Stack.Screen name="sales/new" options={{ title: 'Nueva venta' }} />
      <Stack.Screen name="sales/[id]" options={{ title: 'Detalle de venta' }} />
    </Stack>
  );
}
