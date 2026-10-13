import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Input } from '@/components/ui';
import { theme } from '@/theme';

import { businessDays } from '../constants/businessDays';
import type { useBusinessHours } from '../hooks/useBusinessHours';
import type { BusinessHour } from '../repositories/businessHoursRepository';
import { businessHoursFormSchema, type BusinessHoursInput } from '../schemas/businessHours.schema';

function values(rows: BusinessHour[]) {
  return {
    days: businessDays.map(({ day }) => {
      const row = rows.find((item) => item.day_of_week === day);
      return {
        day_of_week: day,
        open_time: row?.open_time ?? '',
        close_time: row?.close_time ?? '',
        is_closed: row?.is_closed ?? false,
      };
    }),
  };
}
export function BusinessHoursForm({
  initial,
  timezone,
  mutation,
}: {
  initial: BusinessHour[];
  timezone: string;
  mutation: ReturnType<typeof useBusinessHours>['mutation'];
}) {
  const [persistedDays, setPersistedDays] = useState(
    () => new Set(initial.map((row) => row.day_of_week)),
  );
  const lifetimeRef = useRef<symbol | null>(null);
  const inFlightRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, reset, formState } = useForm<{ days: BusinessHoursInput }>({
    resolver: zodResolver(businessHoursFormSchema),
    defaultValues: values(initial),
  });
  useLayoutEffect(() => {
    lifetimeRef.current = Symbol();
    return () => {
      lifetimeRef.current = null;
    };
  }, []);
  const days = useWatch({ control, name: 'days' });
  const pending = formState.isSubmitting || mutation.isPending;
  async function save() {
    if (pending || inFlightRef.current || !formState.isDirty || !lifetimeRef.current) return;
    const operation = lifetimeRef.current;
    inFlightRef.current = true;
    mutation.reset();
    setSaved(false);
    try {
      await handleSubmit(async ({ days }) => {
        if (lifetimeRef.current !== operation) return;
        const data = await mutation.mutateAsync(days);
        if (lifetimeRef.current !== operation) return;
        setPersistedDays(new Set(data.map((row) => row.day_of_week)));
        reset(values(data));
        setSaved(true);
        mutation.reset();
      })();
    } catch {
      /* The safe hook error remains visible; keep all times and closed flags. */
    } finally {
      inFlightRef.current = false;
    }
  }
  return (
    <View style={styles.form}>
      <Text style={styles.text}>
        Horarios locales en {timezone}. Los cambios se usarán para operaciones futuras; no modifican
        citas existentes.
      </Text>
      <Text style={styles.text}>
        No se asignan horarios automáticamente. Para un día nuevo cerrado, indica ambos horarios
        requeridos; quedarán guardados sin habilitar atención.
      </Text>
      {businessDays.map(({ day, label }, index) => (
        <Card key={day} style={styles.form}>
          <Text role="heading" style={styles.heading}>
            {label}
          </Text>
          {!persistedDays.has(day) && <Text style={styles.text}>Sin configurar</Text>}
          <Controller
            name={`days.${index}.is_closed`}
            control={control}
            render={({ field }) => (
              <Button
                label={`${label}: marcar ${field.value ? 'abierto' : 'cerrado'}`}
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
          {(['open_time', 'close_time'] as const).map((key) => (
            <Controller
              key={key}
              control={control}
              name={`days.${index}.${key}`}
              render={({ field, fieldState }) => (
                <Input
                  ref={field.ref}
                  label={`${label}: ${key === 'open_time' ? 'apertura' : 'cierre'}`}
                  placeholder="HH:mm"
                  autoCapitalize="none"
                  value={field.value}
                  onBlur={field.onBlur}
                  disabled={pending || (days[index].is_closed && persistedDays.has(day))}
                  error={fieldState.error?.message}
                  onChangeText={(value) => {
                    field.onChange(value);
                    setSaved(false);
                    mutation.reset();
                  }}
                />
              )}
            />
          ))}
        </Card>
      ))}
      {mutation.error && (
        <Text role="alert" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {saved && (
        <Text role="status" aria-live="polite" style={styles.text}>
          Horarios guardados.
        </Text>
      )}
      <Button
        label="Guardar horarios"
        loading={pending}
        disabled={pending || !formState.isDirty}
        onPress={() => void save()}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
