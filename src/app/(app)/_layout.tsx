import { Stack } from 'expo-router';

import { theme } from '@/theme';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: theme.typography.headingSm,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="settings/index" options={{ title: 'Configuración' }} />
      <Stack.Screen name="business/settings" options={{ title: 'Configuración del negocio' }} />
      <Stack.Screen name="business/hours" options={{ title: 'Horarios de atención' }} />
      <Stack.Screen name="settings/payment-methods" options={{ title: 'Medios de pago' }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notificaciones' }} />
      <Stack.Screen name="settings/appearance" options={{ title: 'Apariencia' }} />
      <Stack.Screen name="settings/profile" options={{ title: 'Perfil y cuenta' }} />
      <Stack.Screen name="appointments/new" options={{ title: 'Nueva cita' }} />
      <Stack.Screen name="appointments/[id]" options={{ title: 'Detalle de cita' }} />
      <Stack.Screen name="clients/new" options={{ title: 'Nuevo cliente' }} />
      <Stack.Screen name="clients/[id]" options={{ title: 'Detalle de cliente' }} />
      <Stack.Screen name="clients/[id]/edit" options={{ title: 'Editar cliente' }} />
      <Stack.Screen name="products/index" options={{ title: 'Productos' }} />
      <Stack.Screen name="services/index" options={{ title: 'Servicios' }} />
      <Stack.Screen name="services/new" options={{ title: 'Crear servicio' }} />
      <Stack.Screen name="services/[id]/edit" options={{ title: 'Editar servicio' }} />
      <Stack.Screen name="products/new" options={{ title: 'Nuevo producto' }} />
      <Stack.Screen name="products/[id]" options={{ title: 'Detalle de producto' }} />
      <Stack.Screen name="products/[id]/stock-adjustment" options={{ title: 'Ajustar stock' }} />
      <Stack.Screen name="expenses/new" options={{ title: 'Nuevo gasto' }} />
      <Stack.Screen name="expenses/categories/index" options={{ title: 'Categorías de gastos' }} />
      <Stack.Screen
        name="expenses/categories/new"
        options={{ title: 'Crear categoría de gastos' }}
      />
      <Stack.Screen
        name="expenses/categories/[id]/edit"
        options={{ title: 'Editar categoría de gastos' }}
      />
      <Stack.Screen name="purchases/index" options={{ title: 'Compras' }} />
      <Stack.Screen name="purchases/[id]" options={{ title: 'Detalle de compra' }} />
      <Stack.Screen name="sales/new" options={{ title: 'Nueva venta' }} />
      <Stack.Screen name="sales/[id]" options={{ title: 'Detalle de venta' }} />
    </Stack>
  );
}
