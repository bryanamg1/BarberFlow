import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { theme } from '@/theme';

import { useAppointmentDuration } from '../hooks/useAppointmentDuration';
import {
  createAppointmentSchema,
  type CreateAppointmentItemInput,
} from '../schemas/appointment.schema';
import { resolveAppointmentDuration } from '../utils/appointmentDuration';

export type AppointmentDurationProps = {
  items: CreateAppointmentItemInput[];
  // Explicit optional durationOverride, not a persisted catalog duration or endAt.
  value: number | undefined;
  onChange: (value: number | undefined) => void;
};

export function AppointmentDuration({ items, value, onChange }: AppointmentDurationProps) {
  const result = useAppointmentDuration(items);
  const scopeKey = JSON.stringify(result.scope);
  const previousScope = useRef(scopeKey);
  const [binding, setBinding] = useState({ key: scopeKey, blocked: false });
  const contextChanged = binding.key !== scopeKey;
  // Quarantine a controlled override until its owner acknowledges the context reset.
  // Derive this during render so even a cached new scope cannot display the old override.
  if (contextChanged) setBinding({ key: scopeKey, blocked: value !== undefined });
  else if (binding.blocked && value === undefined) setBinding({ key: scopeKey, blocked: false });
  useEffect(() => {
    const previous = previousScope.current;
    previousScope.current = scopeKey;
    if (previous !== 'null' && previous !== scopeKey && value !== undefined) onChange(undefined);
  }, [scopeKey, value, onChange]);
  if (result.status === 'idle') return <EmptyState title="Duración no disponible" />;
  if (result.status === 'empty')
    return <EmptyState title="Selecciona servicios para calcular la duración" />;
  if (result.status === 'pending') return <LoadingState message="Calculando duración…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message="No se pudo calcular la duración. Revisa los servicios y la configuración."
        onRetry={result.retry}
      />
    );
  const currentValue = contextChanged || binding.blocked ? undefined : value;
  const duration = resolveAppointmentDuration(
    result.baseDurationMinutes,
    result.scope.role,
    currentValue,
  );
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Duración
      </Text>
      <Text style={styles.text}>
        Duración calculada: {result.baseDurationMinutes.toString()} minutos
      </Text>
      {duration === null ? (
        <Text role="alert" style={styles.error}>
          La duración debe ser un entero positivo permitido. Solo OWNER puede ajustarla.
        </Text>
      ) : (
        <Text role="status" aria-live="polite" style={styles.text}>
          Duración del servicio: {duration} minutos
        </Text>
      )}
      <Text style={styles.hint}>
        Buffer posterior: {result.bufferAfterMinutes} minutos (separado del servicio)
      </Text>
      <Text style={styles.hint}>
        Estimación de catálogo. La duración se confirma al guardar el turno.
      </Text>
      {result.scope.role === 'OWNER' && (
        <OverrideEditor
          key={JSON.stringify([result.scope, items, value])}
          value={currentValue}
          onChange={onChange}
        />
      )}
    </View>
  );
}

function OverrideEditor({ value, onChange }: Pick<AppointmentDurationProps, 'value' | 'onChange'>) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return (
    <View style={styles.section}>
      <Input
        label="Duración personalizada (minutos)"
        value={text}
        keyboardType="number-pad"
        error={error ? 'Ingresa un número entero positivo dentro del máximo permitido.' : undefined}
        onChangeText={(next) => {
          if (live.current) {
            setText(next);
            setError(false);
          }
        }}
      />
      <Button
        label="Aplicar duración"
        onPress={() => {
          if (!live.current) return;
          const parsed = /^\d+$/.test(text)
            ? createAppointmentSchema.shape.durationOverride.unwrap().safeParse(Number(text))
            : null;
          if (!parsed?.success) {
            setError(true);
            return;
          }
          onChange(parsed.data);
        }}
      />
      <Button
        label="Usar duración calculada"
        variant="secondary"
        onPress={() => {
          if (live.current) onChange(undefined);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
