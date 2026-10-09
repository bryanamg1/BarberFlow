import { Stack, usePathname } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { theme } from '@/theme';

export function AuthNavigator() {
  const auth = useAuth();
  const callbackActive = usePathname() === '/auth/recovery';

  // Neither route group mounts until the bootstrap has a settled session result.
  if (auth.status === 'initializing' || auth.status === 'error') {
    return (
      <SafeAreaView style={styles.feedback}>
        {auth.status === 'initializing' ? (
          <LoadingState message="Cargando sesión…" />
        ) : (
          <ErrorState title="No se pudo verificar la sesión" message={auth.error.message} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={auth.status === 'authenticated' && !callbackActive}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status === 'unauthenticated'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status === 'recovering'}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status !== 'recovering'}>
        <Stack.Screen name="auth/recovery" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  feedback: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
});
