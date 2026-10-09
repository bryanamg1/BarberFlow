import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs initialRouteName="index">
      <Tabs.Screen name="index" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda' }} />
      <Tabs.Screen name="quick-action" options={{ title: 'Quick Action' }} />
      <Tabs.Screen name="clients" options={{ title: 'Clientes' }} />
      <Tabs.Screen name="finances" options={{ title: 'Finanzas' }} />
      <Tabs.Screen name="settings/index" options={{ title: 'Configuración' }} />
    </Tabs>
  );
}
