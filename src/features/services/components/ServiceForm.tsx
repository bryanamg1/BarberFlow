import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

import { useCreateService } from '../hooks/useCreateService';
import type { ServiceRow } from '../repositories/servicesRepository';
import type { CreateServiceInput } from '../schemas/service.schema';
import { ServiceEditForm } from './ServiceEditForm';
import { ServiceFields } from './ServiceFields';
import { serviceCreateFormSchema, type ServiceCreateFormValues } from './serviceCreateForm.schema';

export type ServiceFormProps = {
  currency: string;
  onCancel: () => void;
} & (
  | { mode?: 'create'; onSuccess: (service: ServiceRow) => void }
  | { mode: 'edit'; serviceId: string; initialService: ServiceRow }
);

// Shared fields, with separate create and edit orchestration.
export function ServiceForm(props: ServiceFormProps) {
  return props.mode === 'edit' ? <ServiceEditForm {...props} /> : <CreateServiceForm {...props} />;
}

function CreateServiceForm({
  currency,
  onSuccess,
  onCancel,
}: Extract<ServiceFormProps, { mode?: 'create' }>) {
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
      <ServiceFields
        control={control}
        setFocus={setFocus}
        currency={currency}
        disabled={blocked}
        onChange={() => {
          if (mutation.status === 'error') mutation.reset();
        }}
        onSubmit={() => void submit()}
      />
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
