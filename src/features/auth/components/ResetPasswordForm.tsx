import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { Button, PasswordInput } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { theme } from '@/theme';
import { resetPasswordSchema, type ResetPasswordValues } from '../schemas/recovery.schema';
import { authService } from '../services/authService';

export function ResetPasswordForm() {
  const auth = useAuth();
  const { control, handleSubmit, reset, setFocus } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmation: '' },
  });
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit() {
    if (auth.status !== 'recovering' || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(undefined);
    let changed = updated;
    try {
      if (!changed) {
        await handleSubmit(async ({ password }) => {
          const result = await authService.updatePassword({ password });
          if (!mounted.current) return;
          if (result.error) setError(result.error.message);
          else {
            changed = true;
            setUpdated(true);
            reset();
          }
        })();
      }
      if (changed && mounted.current) {
        const result = await authService.signOut();
        if (mounted.current && result.error)
          setError(
            'Tu contraseña fue actualizada, pero no se pudo cerrar la sesión. Reintenta el cierre de sesión.',
          );
      }
    } catch {
      if (mounted.current)
        setError(
          changed
            ? 'Tu contraseña fue actualizada, pero no se pudo cerrar la sesión. Reintenta el cierre de sesión.'
            : 'No se pudo completar la operación. Inténtalo nuevamente.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  if (auth.status !== 'recovering') return null;
  return (
    <View style={styles.container}>
      {!updated && (
        <>
          <Controller
            control={control}
            name="password"
            render={({
              field: { ref, value, onChange, onBlur },
              fieldState: { error: fieldError },
            }) => (
              <PasswordInput
                ref={ref}
                label="Nueva contraseña"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={fieldError?.message}
                disabled={submitting}
                autoComplete="new-password"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => setFocus('confirmation')}
              />
            )}
          />
          <Controller
            control={control}
            name="confirmation"
            render={({
              field: { ref, value, onChange, onBlur },
              fieldState: { error: fieldError },
            }) => (
              <PasswordInput
                ref={ref}
                label="Confirmar contraseña"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={fieldError?.message}
                disabled={submitting}
                autoComplete="new-password"
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
              />
            )}
          />
        </>
      )}
      {updated && (
        <Text role="status" aria-live="polite" style={styles.message}>
          Tu contraseña fue actualizada.
        </Text>
      )}
      {error && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {error}
        </Text>
      )}
      <Button
        label={updated ? 'Reintentar cierre de sesión' : 'Guardar contraseña'}
        loading={submitting}
        onPress={() => void submit()}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: theme.spacing[16] },
  message: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
