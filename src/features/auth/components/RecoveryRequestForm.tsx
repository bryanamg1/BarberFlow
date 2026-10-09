import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { theme } from '@/theme';
import { recoveryRequestSchema, type RecoveryRequestValues } from '../schemas/recovery.schema';
import { authService } from '../services/authService';

export function RecoveryRequestForm() {
  const { control, handleSubmit } = useForm<RecoveryRequestValues>({
    resolver: zodResolver(recoveryRequestSchema),
    defaultValues: { email: '' },
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage(undefined);
    setFailed(false);
    try {
      await handleSubmit(async (values) => {
        const result = await authService.requestPasswordRecovery(values);
        if (!mounted.current) return;
        setFailed(!!result.error);
        setMessage(
          result.error?.message ??
            'Si existe una cuenta asociada a ese correo, recibirás instrucciones para restablecer tu contraseña.',
        );
      })();
    } catch {
      if (mounted.current) {
        setFailed(true);
        setMessage('No se pudo completar la operación. Inténtalo nuevamente.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  return (
    <View style={styles.container}>
      <Controller
        control={control}
        name="email"
        render={({ field: { ref, value, onChange, onBlur }, fieldState: { error } }) => (
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
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      {message && (
        <Text
          role={failed ? 'alert' : 'status'}
          aria-live={failed ? 'assertive' : 'polite'}
          style={failed ? styles.error : styles.message}
        >
          {message}
        </Text>
      )}
      <Button label="Enviar instrucciones" loading={submitting} onPress={() => void submit()} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: theme.spacing[16] },
  message: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
