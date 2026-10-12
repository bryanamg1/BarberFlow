import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

import { useCreateClient } from '../hooks/useCreateClient';
import type { ClientRow } from '../repositories/clientsRepository';
import { createClientSchema, type CreateClientInput } from '../schemas/client.schema';
import { ClientEditForm } from './ClientEditForm';
import { ClientTextField, clientTextFields as fields } from './ClientTextField';

export type ClientFormProps = {
  onSuccess: (client: ClientRow) => void;
  onCancel: () => void;
} & ({ mode: 'create' } | { mode: 'edit'; clientId: string; initialClient: ClientRow });

export function ClientForm(props: ClientFormProps) {
  return props.mode === 'create' ? <CreateClientForm {...props} /> : <ClientEditForm {...props} />;
}

function CreateClientForm({ onSuccess, onCancel }: Extract<ClientFormProps, { mode: 'create' }>) {
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
      {fields.map((field, index) => (
        <Controller
          key={field.name}
          control={control}
          name={field.name}
          render={({ field: { ref, value, onChange, onBlur }, fieldState: { error } }) => (
            <ClientTextField
              field={field}
              inputRef={ref}
              value={value}
              onBlur={onBlur}
              onChange={onChange}
              error={error?.message}
              disabled={blocked}
              onNext={fields[index + 1] ? () => setFocus(fields[index + 1].name) : undefined}
            />
          )}
        />
      ))}
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
