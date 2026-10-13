import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { theme } from '@/theme';

import { useCreateService } from '../hooks/useCreateService';
import type { ServiceRow } from '../repositories/servicesRepository';
import type { CreateServiceInput } from '../schemas/service.schema';
import { serviceCreateFormSchema, type ServiceCreateFormValues } from './serviceCreateForm.schema';

type ServiceFormProps = {
  currency: string;
  onSuccess: (service: ServiceRow) => void;
  onCancel: () => void;
};

const fields = [
  { name: 'name', label: 'Nombre (obligatorio)' },
  { name: 'description', label: 'Descripción' },
  { name: 'price', label: 'Precio (obligatorio)' },
  { name: 'duration_minutes', label: 'Duración en minutos (obligatorio)' },
] as const;

// Shared field/action composition for Services; BF134 supplies create behavior only.
export function ServiceForm({ currency, onSuccess, onCancel }: ServiceFormProps) {
  const mutation = useCreateService();
  const { control, handleSubmit, setFocus, formState } = useForm<
    ServiceCreateFormValues,
    unknown,
    CreateServiceInput
  >({
    resolver: zodResolver(serviceCreateFormSchema),
    defaultValues: { name: '', price: '', duration_minutes: '' },
  });
  const inFlight = useRef(false);
  const lifetime = useRef<symbol | null>(null);
  const pending = formState.isSubmitting || mutation.status === 'pending';
  const blocked = pending || mutation.status === 'success';

  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);

  async function submit() {
    if (inFlight.current || blocked || lifetime.current === null) return;
    inFlight.current = true;
    const operationLifetime = lifetime.current;
    const isCurrent = () => lifetime.current === operationLifetime;
    let succeeded = false;
    mutation.reset();
    try {
      await handleSubmit(async (values) => {
        if (!isCurrent()) return;
        const input: CreateServiceInput = {
          name: values.name,
          price: values.price,
          duration_minutes: values.duration_minutes,
        };
        if (values.description !== undefined) input.description = values.description;
        const created = await mutation.mutateAsync(input);
        succeeded = true;
        if (isCurrent()) onSuccess(created);
      })();
    } catch {
      // Hook owns the safe error. A rejected operation never changes navigation or draft values.
    } finally {
      if (!succeeded) inFlight.current = false;
    }
  }

  return (
    <View style={styles.form}>
      {fields.map((field, index) => (
        <Controller
          key={field.name}
          control={control}
          name={field.name}
          render={({ field: { ref, value, onChange, onBlur }, fieldState: { error } }) => (
            <Input
              ref={ref}
              label={field.label}
              value={value ?? ''}
              onBlur={onBlur}
              onChangeText={(text) => {
                if (blocked) return;
                if (mutation.status === 'error') mutation.reset();
                onChange(text);
              }}
              error={error?.message}
              disabled={blocked}
              multiline={field.name === 'description'}
              keyboardType={
                field.name === 'price'
                  ? 'decimal-pad'
                  : field.name === 'duration_minutes'
                    ? 'number-pad'
                    : 'default'
              }
              inputMode={
                field.name === 'price'
                  ? 'decimal'
                  : field.name === 'duration_minutes'
                    ? 'numeric'
                    : 'text'
              }
              helperText={
                field.name === 'price'
                  ? `${currency} · Usa punto para decimales (ej. 10000.50).`
                  : undefined
              }
              autoCapitalize={
                field.name === 'price' || field.name === 'duration_minutes' ? 'none' : 'sentences'
              }
              returnKeyType={field.name === 'duration_minutes' ? 'done' : 'next'}
              onSubmitEditing={
                field.name === 'description'
                  ? undefined
                  : () => {
                      if (blocked) return;
                      const next = fields[index + 1];
                      if (next) setFocus(next.name);
                      else void submit();
                    }
              }
            />
          )}
        />
      ))}
      {mutation.status === 'error' && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {pending && (
        <Text role="status" aria-live="polite" style={styles.status}>
          Creando servicio…
        </Text>
      )}
      <Button
        label="Crear servicio"
        loading={pending}
        disabled={mutation.status === 'success'}
        onPress={() => void submit()}
      />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={blocked}
        onPress={() => {
          if (inFlight.current || blocked) return;
          lifetime.current = null;
          onCancel();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  error: { ...theme.typography.body, color: theme.colors.danger },
  status: { ...theme.typography.body, color: theme.colors.textSecondary },
});
