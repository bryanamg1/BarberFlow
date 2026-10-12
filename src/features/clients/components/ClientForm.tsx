import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { theme } from '@/theme';

import { useCreateClient } from '../hooks/useCreateClient';
import type { ClientRow } from '../repositories/clientsRepository';
import { createClientSchema, type CreateClientInput } from '../schemas/client.schema';

export type ClientFormProps = {
  mode: 'create';
  onSuccess: (client: ClientRow) => void;
  onCancel: () => void;
};

const fields = [
  { name: 'first_name', label: 'Nombre (obligatorio)' },
  { name: 'last_name', label: 'Apellido' },
  { name: 'phone', label: 'Teléfono' },
  { name: 'email', label: 'Email' },
  { name: 'instagram', label: 'Instagram' },
  { name: 'birth_date', label: 'Fecha de nacimiento' },
  { name: 'notes', label: 'Notas' },
  { name: 'preferences', label: 'Preferencias' },
] as const;

export function ClientForm({ onSuccess, onCancel }: ClientFormProps) {
  const mutation = useCreateClient();
  const { control, handleSubmit, setFocus, formState } = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    defaultValues: { first_name: '' },
  });
  const inFlight = useRef(false);
  const lifetime = useRef<symbol | null>(null);
  const blocked =
    formState.isSubmitting || mutation.status === 'pending' || mutation.status === 'success';

  // Invalidate callbacks at commit cleanup, including a business-key remount while awaiting validation.
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
        // Explicit allowlist: untouched optional fields stay absent, edited text stays unchanged.
        const input: CreateClientInput = { first_name: values.first_name };
        for (const { name } of fields) {
          if (name === 'first_name') continue;
          const value = values[name];
          if (value !== undefined) input[name] = value;
        }
        const client = await mutation.mutateAsync(input);
        succeeded = true;
        if (isCurrent()) onSuccess(client);
      })();
    } catch {
      // The hook owns the normalized mutation error; never copy or expose its rejection here.
    } finally {
      // A completed create cannot be submitted again while its navigation is being committed.
      if (!succeeded) inFlight.current = false;
    }
  }

  return (
    <View style={styles.form}>
      {fields.map(({ name, label }, index) => {
        const multiline = name === 'notes' || name === 'preferences';
        return (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field: { ref, value, onChange, onBlur }, fieldState: { error } }) => (
              <Input
                ref={ref}
                label={label}
                value={value ?? ''}
                onBlur={onBlur}
                onChangeText={(text) =>
                  onChange(name === 'birth_date' && text === '' ? null : text)
                }
                error={error?.message}
                disabled={blocked}
                helperText={name === 'birth_date' ? 'YYYY-MM-DD (opcional)' : undefined}
                placeholder={name === 'birth_date' ? 'YYYY-MM-DD' : undefined}
                multiline={multiline}
                numberOfLines={multiline ? 4 : 1}
                autoCapitalize={name === 'email' || name === 'instagram' ? 'none' : 'sentences'}
                keyboardType={
                  name === 'phone' ? 'phone-pad' : name === 'email' ? 'email-address' : 'default'
                }
                returnKeyType={multiline ? 'default' : 'next'}
                submitBehavior={multiline ? 'newline' : 'submit'}
                onSubmitEditing={multiline ? undefined : () => setFocus(fields[index + 1].name)}
              />
            )}
          />
        );
      })}
      {mutation.status === 'error' && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      <Button
        label="Crear cliente"
        loading={formState.isSubmitting || mutation.status === 'pending'}
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
});
