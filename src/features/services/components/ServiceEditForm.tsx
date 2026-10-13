import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Modal } from '@/components/ui';
import { theme } from '@/theme';

import { useUpdateService } from '../hooks/useUpdateService';
import type { ServiceRow } from '../repositories/servicesRepository';
import { updateServiceSchema, type UpdateServiceInput } from '../schemas/service.schema';
import { ServiceFields } from './ServiceFields';
import type { ServiceFormProps } from './ServiceForm';
import { serviceEditFormSchema, type ServiceCreateFormValues } from './serviceCreateForm.schema';

function formValues(service: ServiceRow): ServiceCreateFormValues {
  return {
    name: service.name,
    description: service.description ?? '',
    price: String(service.price),
    duration_minutes: String(service.duration_minutes),
  };
}

export function ServiceEditForm({
  serviceId,
  initialService,
  currency,
  onCancel,
}: Extract<ServiceFormProps, { mode: 'edit' }>) {
  const mutation = useUpdateService();
  const { control, handleSubmit, setFocus, reset, formState } = useForm<
    ServiceCreateFormValues,
    unknown,
    UpdateServiceInput
  >({
    resolver: zodResolver(serviceEditFormSchema),
    // Captured once per business/route identity; ordinary detail refetch never resets a draft.
    defaultValues: formValues(initialService),
  });
  const { dirtyFields, isDirty, isSubmitting } = formState;
  const [confirmation, setConfirmation] = useState<boolean | null>(null);
  // Returned persisted status bridges an awaited write and the next actual detail snapshot.
  const [savedStatus, setSavedStatus] = useState<{ source: ServiceRow; active: boolean } | null>(
    null,
  );
  const active =
    savedStatus?.source === initialService ? savedStatus.active : initialService.is_active;
  const inFlight = useRef(false);
  const detailSource = useRef(initialService);
  const lifetime = useRef<symbol | null>(null);
  const pending = isSubmitting || mutation.status === 'pending';
  const blocked = pending || confirmation !== null;

  useLayoutEffect(() => {
    detailSource.current = initialService;
  }, [initialService]);

  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);

  async function perform(input: UpdateServiceInput, statusOnly: boolean, operation: symbol) {
    const persisted = await mutation.mutateAsync({ serviceId, input });
    if (lifetime.current !== operation) return;
    // A status operation never submits or discards unsaved fields. All defaults come from the server.
    reset(formValues(persisted), statusOnly ? { keepDirtyValues: true } : undefined);
    setSavedStatus({ source: detailSource.current, active: persisted.is_active });
    setConfirmation(null);
    mutation.reset();
  }

  async function save() {
    if (!isDirty || blocked || inFlight.current || lifetime.current === null) return;
    const operation = lifetime.current;
    inFlight.current = true;
    mutation.reset();
    try {
      await handleSubmit(async (values) => {
        if (lifetime.current !== operation) return;
        const input: UpdateServiceInput = {};
        if (dirtyFields.name) input.name = values.name;
        if (dirtyFields.description) input.description = values.description;
        if (dirtyFields.price) input.price = values.price;
        if (dirtyFields.duration_minutes) input.duration_minutes = values.duration_minutes;
        if (Object.keys(input).length === 0) return;
        await perform(updateServiceSchema.parse(input), false, operation);
      })();
    } catch {
      // The hook owns normalized errors. Keep draft and current persisted status on rejection.
    } finally {
      inFlight.current = false;
    }
  }

  async function changeStatus() {
    if (confirmation === null || pending || inFlight.current || lifetime.current === null) return;
    const operation = lifetime.current;
    inFlight.current = true;
    mutation.reset();
    try {
      await perform(updateServiceSchema.parse({ is_active: confirmation }), true, operation);
    } catch {
      // The confirmation stays open for a controlled retry; no optimistic status change.
    } finally {
      inFlight.current = false;
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
        onSubmit={() => void save()}
      />
      <Badge label={active ? 'Activo' : 'Archivado'} tone={active ? 'success' : 'neutral'} />
      <Button
        label={active ? 'Archivar servicio' : 'Restaurar servicio'}
        variant="outline"
        disabled={blocked}
        onPress={() => {
          if (!inFlight.current && !blocked) setConfirmation(!active);
        }}
      />
      {confirmation === null && mutation.status === 'error' && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {pending && (
        <Text role="status" aria-live="polite" style={styles.status}>
          Guardando servicio…
        </Text>
      )}
      <Button
        label="Guardar cambios"
        disabled={!isDirty || blocked}
        loading={pending}
        onPress={() => void save()}
      />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={blocked}
        onPress={() => {
          if (blocked || inFlight.current) return;
          lifetime.current = null;
          onCancel();
        }}
      />
      <Modal
        visible={confirmation !== null}
        dismissible={!pending}
        closeLabel="Seguir editando"
        onClose={() => {
          if (!inFlight.current && !pending) setConfirmation(null);
        }}
        title={confirmation ? '¿Restaurar servicio?' : '¿Archivar servicio?'}
        description={
          confirmation
            ? 'El servicio volverá a estar activo.'
            : 'El servicio quedará archivado. No se eliminará y podrás restaurarlo.'
        }
        actions={
          <>
            {mutation.status === 'error' && (
              <Text role="alert" aria-live="assertive" style={styles.error}>
                {mutation.error.message}
              </Text>
            )}
            {pending && (
              <Text role="status" aria-live="polite" style={styles.status}>
                Guardando servicio…
              </Text>
            )}
            <Button
              label={confirmation ? 'Confirmar restauración' : 'Confirmar archivo'}
              loading={pending}
              onPress={() => void changeStatus()}
            />
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  error: { ...theme.typography.body, color: theme.colors.danger },
  status: { ...theme.typography.body, color: theme.colors.textSecondary },
});
