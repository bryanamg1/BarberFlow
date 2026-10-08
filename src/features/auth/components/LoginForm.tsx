import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Input, PasswordInput } from '@/components/ui';
import { theme } from '@/theme';

import { loginSchema, type LoginFormValues } from '../schemas/login.schema';
import { authService } from '../services/authService';

export type LoginFormProps = {
  onSuccess?: () => void;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { control, handleSubmit, setFocus } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit() {
    // Cover asynchronous validation too, before React can render the disabled button.
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setAuthError(undefined);
    let succeeded = false;

    try {
      await handleSubmit(async (values) => {
        const result = await authService.signInWithPassword(values);
        if (!mounted.current) return;
        if (result.error) setAuthError(result.error.message);
        else succeeded = true;
      })();
    } catch {
      if (mounted.current) {
        setAuthError('No se pudo completar la operación. Inténtalo nuevamente.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }

    if (mounted.current && succeeded) onSuccess?.();
  }

  return (
    <View style={styles.container}>
      <Controller
        control={control}
        name="email"
        render={({ field: { ref, onChange, onBlur, value }, fieldState: { error } }) => (
          <Input
            ref={ref}
            label="Correo electrónico"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={error?.message}
            disabled={submitting}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => setFocus('password')}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { ref, onChange, onBlur, value }, fieldState: { error } }) => (
          <PasswordInput
            ref={ref}
            label="Contraseña"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={error?.message}
            disabled={submitting}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      {authError && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {authError}
        </Text>
      )}
      <Button label="Iniciar sesión" loading={submitting} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing[16] },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
