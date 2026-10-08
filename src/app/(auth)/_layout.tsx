import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: 'Iniciar sesión', headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Recuperar contraseña' }} />
    </Stack>
  );
}
