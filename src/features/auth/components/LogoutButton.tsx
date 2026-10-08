import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

import { authService } from '../services/authService';

export function LogoutButton() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function logout() {
    // Block same-turn presses before the loading state reaches the shared Button.
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(undefined);

    try {
      const result = await authService.signOut();
      if (mounted.current && result.error) setError(result.error.message);
    } catch {
      if (mounted.current) {
        setError('No se pudo completar la operación. Inténtalo nuevamente.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Button
        label="Cerrar sesión"
        variant="secondary"
        loading={submitting}
        onPress={() => void logout()}
      />
      {error && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing[16] },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
