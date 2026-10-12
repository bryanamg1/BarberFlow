import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Modal } from '@/components/ui';
import { theme } from '@/theme';

import { useUpdateClient } from '../hooks/useUpdateClient';
import { updateClientSchema, type UpdateClientInput } from '../schemas/client.schema';
import type { ClientFormProps } from './ClientForm';
import { ClientTextField, clientTextFields } from './ClientTextField';

export function ClientEditForm({
  clientId,
  initialClient,
  onSuccess,
  onCancel,
}: Extract<ClientFormProps, { mode: 'edit' }>) {
  const mutation = useUpdateClient();
  const { control, handleSubmit, setFocus, setValue, formState } = useForm<UpdateClientInput>({
    resolver: zodResolver(updateClientSchema),
    // RHF captures these defaults once. The screen remounts only for a new business/route identity.
    defaultValues: {
      first_name: initialClient.first_name,
      last_name: initialClient.last_name,
      phone: initialClient.phone,
      email: initialClient.email,
      instagram: initialClient.instagram,
      birth_date: initialClient.birth_date,
      notes: initialClient.notes,
      preferences: initialClient.preferences,
      is_active: initialClient.is_active,
    },
  });
  const { dirtyFields, isDirty, isSubmitting } = formState;
  const active = useWatch({ control, name: 'is_active' });
  const [statusChange, setStatusChange] = useState<boolean | null>(null);
  const inFlight = useRef(false);
  const lifetime = useRef<symbol | null>(null);
  const blocked = isSubmitting || mutation.status === 'pending' || mutation.status === 'success';
  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);

  async function submit() {
    if (!isDirty || inFlight.current || blocked || lifetime.current === null) return;
    inFlight.current = true;
    const operationLifetime = lifetime.current;
    const isCurrent = () => lifetime.current === operationLifetime;
    let succeeded = false;
    mutation.reset();
    try {
      await handleSubmit(async (values) => {
        if (!isCurrent()) return;
        const input: UpdateClientInput = {};
        if (dirtyFields.first_name && values.first_name !== undefined)
          input.first_name = values.first_name;
        for (const { name } of clientTextFields) {
          if (name === 'first_name' || !dirtyFields[name]) continue;
          const value = values[name];
          if (value !== undefined) input[name] = value;
        }
        if (dirtyFields.is_active && values.is_active !== undefined)
          input.is_active = values.is_active;
        if (Object.keys(input).length === 0) return;
        const client = await mutation.mutateAsync({ clientId, input });
        succeeded = true;
        if (isCurrent()) onSuccess(client);
      })();
    } catch {
      // Only the hook's normalized error is rendered; draft and dirty fields remain intact.
    } finally {
      if (!succeeded) inFlight.current = false;
    }
  }

  return (
    <View style={styles.form}>
      {clientTextFields.map((field, index) => (
        <Controller
          key={field.name}
          name={field.name}
          control={control}
          render={({ field: { ref, value, onChange, onBlur }, fieldState: { error } }) => (
            <ClientTextField
              field={field}
              value={value}
              onChange={onChange}
              onBlur={onBlur}
              inputRef={ref}
              error={error?.message}
              disabled={blocked}
              onNext={
                clientTextFields[index + 1]
                  ? () => setFocus(clientTextFields[index + 1].name)
                  : undefined
              }
            />
          )}
        />
      ))}
      <Badge label={active ? 'Activo' : 'Archivado'} tone={active ? 'success' : 'neutral'} />
      <Button
        label={active ? 'Archivar cliente' : 'Restaurar cliente'}
        variant="outline"
        disabled={blocked}
        onPress={() => {
          if (!inFlight.current && !blocked) setStatusChange(!active);
        }}
      />
      <Text style={styles.help}>El cambio de estado se aplicará al guardar.</Text>
      {mutation.status === 'error' && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      <Button
        label="Guardar cambios"
        disabled={!isDirty || mutation.status === 'success'}
        loading={isSubmitting || mutation.status === 'pending'}
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
      <Modal
        visible={statusChange !== null}
        onClose={() => setStatusChange(null)}
        title={statusChange ? '¿Restaurar cliente?' : '¿Archivar cliente?'}
        description={
          statusChange
            ? 'El cliente volverá a estar activo al guardar los cambios.'
            : 'El cliente quedará archivado al guardar los cambios. Su información se conservará.'
        }
        closeLabel="Seguir editando"
        actions={
          <Button
            label={statusChange ? 'Confirmar restauración' : 'Confirmar archivo'}
            onPress={() => {
              if (statusChange === null || inFlight.current || blocked) return;
              setValue('is_active', statusChange, { shouldDirty: true });
              setStatusChange(null);
            }}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  help: { ...theme.typography.caption, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
