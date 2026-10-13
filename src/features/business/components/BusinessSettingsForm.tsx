import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { Button, Card, Input, Modal } from '@/components/ui';
import { theme } from '@/theme';

import {
  useUpdateBusinessPreferences,
  useUpdateBusinessProfile,
} from '../hooks/useBusinessSettings';
import type { BusinessConfiguration } from '../repositories/businessConfigurationRepository';
import type { BusinessSettings } from '../repositories/businessSettingsRepository';
import {
  businessProfileSchema,
  businessPreferencesSchema,
  type UpdateBusinessProfileInput,
  type UpdateBusinessPreferencesInput,
} from '../schemas/businessSettings.schema';

const profileFields = [
  ['name', 'Nombre del negocio'],
  ['phone', 'Teléfono'],
  ['email', 'Email'],
  ['address', 'Dirección'],
  ['currency_code', 'Moneda'],
  ['timezone', 'Zona horaria IANA'],
] as const;
const integerText = z.string().regex(/^\d+$/, 'Ingresa un número entero.').transform(Number);
export const preferencesFormSchema = businessPreferencesSchema.extend({
  appointment_interval_minutes: integerText.pipe(
    businessPreferencesSchema.shape.appointment_interval_minutes,
  ),
  default_service_buffer_minutes: integerText.pipe(
    businessPreferencesSchema.shape.default_service_buffer_minutes,
  ),
});
function preferenceValues(value: BusinessSettings) {
  return {
    ...value,
    appointment_interval_minutes: String(value.appointment_interval_minutes),
    default_service_buffer_minutes: String(value.default_service_buffer_minutes),
  };
}
function useLifetime() {
  const lifetimeRef = useRef<symbol | null>(null);
  const inFlightRef = useRef(false);
  useLayoutEffect(() => {
    lifetimeRef.current = Symbol();
    return () => {
      lifetimeRef.current = null;
    };
  }, []);
  return { lifetimeRef, inFlightRef };
}

export function BusinessSettingsForm({
  profile,
  preferences,
}: {
  profile: BusinessConfiguration;
  preferences: BusinessSettings;
}) {
  return (
    <View style={styles.form}>
      <ProfileForm initial={profile} />
      <PreferencesForm initial={preferences} />
    </View>
  );
}
function ProfileForm({ initial }: { initial: BusinessConfiguration }) {
  const mutation = useUpdateBusinessProfile();
  const { lifetimeRef, inFlightRef } = useLifetime();
  const [confirmation, setConfirmation] = useState<UpdateBusinessProfileInput | null>(null);
  const [saved, setSaved] = useState(false);
  const persistedTimezone = useRef(initial.timezone);
  const { control, handleSubmit, reset, formState } = useForm({
    resolver: zodResolver(businessProfileSchema),
    defaultValues: initial,
  });
  const pending = formState.isSubmitting || mutation.isPending;
  const blocked = pending || confirmation !== null;
  async function perform(input: UpdateBusinessProfileInput, operation: symbol) {
    const data = await mutation.mutateAsync(input);
    if (lifetimeRef.current !== operation) return;
    reset(data);
    persistedTimezone.current = data.timezone;
    setConfirmation(null);
    setSaved(true);
    mutation.reset();
  }
  async function save() {
    if (blocked || inFlightRef.current || !formState.isDirty || !lifetimeRef.current) return;
    const operation = lifetimeRef.current;
    inFlightRef.current = true;
    mutation.reset();
    setSaved(false);
    try {
      await handleSubmit(async (values) => {
        if (lifetimeRef.current !== operation) return;
        const input: UpdateBusinessProfileInput = {};
        for (const [key] of profileFields) {
          if (formState.dirtyFields[key]) Object.assign(input, { [key]: values[key] });
        }
        if (Object.keys(input).length === 0) return;
        if (input.timezone !== undefined && input.timezone !== persistedTimezone.current) {
          setConfirmation(input);
          return;
        }
        await perform(input, operation);
      })();
    } catch {
      /* Safe hook error; keep the draft. */
    } finally {
      inFlightRef.current = false;
    }
  }
  async function confirm() {
    if (!confirmation || pending || inFlightRef.current || !lifetimeRef.current) return;
    const operation = lifetimeRef.current;
    inFlightRef.current = true;
    try {
      await perform(confirmation, operation);
    } catch {
      /* Keep confirmation and draft for an explicit retry. */
    } finally {
      inFlightRef.current = false;
    }
  }
  return (
    <Card style={styles.form}>
      <Text role="heading" style={styles.heading}>
        Datos del negocio
      </Text>
      <Text style={styles.text}>La moneda queda bloqueada al registrar actividad financiera.</Text>
      {profileFields.map(([name, label]) => (
        <Controller
          key={name}
          name={name}
          control={control}
          render={({ field, fieldState }) => (
            <Input
              label={label}
              ref={field.ref}
              value={field.value ?? ''}
              onBlur={field.onBlur}
              disabled={blocked}
              error={fieldState.error ? 'Revisa este campo.' : undefined}
              autoCapitalize={name === 'timezone' || name === 'email' ? 'none' : 'sentences'}
              onChangeText={(value) => {
                field.onChange(value);
                setSaved(false);
                mutation.reset();
              }}
            />
          )}
        />
      ))}
      {confirmation === null && mutation.error && (
        <Text role="alert" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {saved && (
        <Text role="status" aria-live="polite" style={styles.text}>
          Datos del negocio guardados.
        </Text>
      )}
      <Button
        label="Guardar datos del negocio"
        loading={pending}
        disabled={blocked || !formState.isDirty}
        onPress={() => void save()}
      />
      <Modal
        visible={confirmation !== null}
        dismissible={!pending}
        title="¿Cambiar zona horaria?"
        description="Se usará para las operaciones futuras. No se modificarán los importes ni los timestamps históricos."
        closeLabel="Seguir editando"
        onClose={() => {
          if (!pending && !inFlightRef.current) setConfirmation(null);
        }}
        actions={
          <>
            {mutation.error && (
              <Text role="alert" style={styles.error}>
                {mutation.error.message}
              </Text>
            )}
            <Button
              label="Confirmar zona horaria"
              loading={pending}
              onPress={() => void confirm()}
            />
          </>
        }
      />
    </Card>
  );
}
function PreferencesForm({ initial }: { initial: BusinessSettings }) {
  const mutation = useUpdateBusinessPreferences();
  const { lifetimeRef, inFlightRef } = useLifetime();
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, reset, formState } = useForm<
    z.input<typeof preferencesFormSchema>,
    unknown,
    z.output<typeof preferencesFormSchema>
  >({ resolver: zodResolver(preferencesFormSchema), defaultValues: preferenceValues(initial) });
  const pending = formState.isSubmitting || mutation.isPending;
  async function save() {
    if (pending || inFlightRef.current || !formState.isDirty || !lifetimeRef.current) return;
    const operation = lifetimeRef.current;
    inFlightRef.current = true;
    mutation.reset();
    setSaved(false);
    try {
      await handleSubmit(async (values) => {
        if (lifetimeRef.current !== operation) return;
        const input: UpdateBusinessPreferencesInput = {};
        for (const key of Object.keys(
          businessPreferencesSchema.shape,
        ) as (keyof UpdateBusinessPreferencesInput)[]) {
          if (formState.dirtyFields[key]) Object.assign(input, { [key]: values[key] });
        }
        if (!Object.keys(input).length) return;
        const data = await mutation.mutateAsync(input);
        if (lifetimeRef.current !== operation) return;
        reset(preferenceValues(data));
        setSaved(true);
        mutation.reset();
      })();
    } catch {
      /* Preserve draft; hook owns safe error. */
    } finally {
      inFlightRef.current = false;
    }
  }
  return (
    <Card style={styles.form}>
      <Text role="heading" style={styles.heading}>
        Agenda y stock
      </Text>
      {(
        [
          ['appointment_interval_minutes', 'Intervalo de turnos (minutos)'],
          ['default_service_buffer_minutes', 'Buffer entre servicios (minutos)'],
        ] as const
      ).map(([name, label]) => (
        <Controller
          key={name}
          name={name}
          control={control}
          render={({ field, fieldState }) => (
            <Input
              label={label}
              ref={field.ref}
              value={field.value}
              keyboardType="number-pad"
              disabled={pending}
              onBlur={field.onBlur}
              error={
                fieldState.error
                  ? 'Ingresa un entero válido: intervalo mayor a cero, buffer no negativo.'
                  : undefined
              }
              onChangeText={(value) => {
                field.onChange(value);
                setSaved(false);
                mutation.reset();
              }}
            />
          )}
        />
      ))}
      {(
        [
          ['allow_overlapping_appointments', 'Permitir citas superpuestas'],
          ['low_stock_notifications', 'Avisos de stock bajo'],
        ] as const
      ).map(([name, label]) => (
        <Controller
          key={name}
          name={name}
          control={control}
          render={({ field }) => (
            <Button
              label={`${label}: ${field.value ? 'Sí' : 'No'}`}
              variant="outline"
              disabled={pending}
              onPress={() => {
                field.onChange(!field.value);
                setSaved(false);
                mutation.reset();
              }}
            />
          )}
        />
      ))}
      {mutation.error && (
        <Text role="alert" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {saved && (
        <Text role="status" aria-live="polite" style={styles.text}>
          Reglas de agenda y stock guardadas.
        </Text>
      )}
      <Button
        label="Guardar reglas de agenda y stock"
        loading={pending}
        disabled={pending || !formState.isDirty}
        onPress={() => void save()}
      />
    </Card>
  );
}
const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
